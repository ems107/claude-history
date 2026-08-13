import { query, type PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import type { AppSettings, ChatModelInfo, ChatQuestion, ChatState, ChatStatus } from '@claude-history/shared';
import { CHAT_MESSAGE_MAX } from '@claude-history/shared';
import { cleanEnv, findClaudeCli, forgetClaudeCli } from '../util/launcher.ts';
import type { SessionIndex } from './index.ts';
import { pidAlive } from './live.ts';
import { createLogger } from './logger.ts';

const log = createLogger('chat');

/** How often the idle sweep runs. Same cadence as the auto-reload's tick. */
const TICK_MS = 30_000;

/**
 * A turn with no output at all for this long is treated as wedged and killed.
 * It is not a cap on how long Claude may work — every line it writes resets the
 * clock — and it is explicitly suspended while a question is waiting, because
 * then the silence is ours, not the CLI's.
 */
const TURN_SILENCE_MS = 10 * 60_000;

/**
 * Processes alive at once. Each holds a CLI with its MCP servers loaded, so
 * this is about the machine, not correctness.
 */
const MAX_CHAT_SESSIONS = 3;

/** Only for a caller that sends no model — the composer always sends one. */
const FALLBACK_MODEL = 'sonnet';

/** Resolves when the user answers, with the payload to hand back to the tool. */
interface PendingAsk {
  question: ChatQuestion;
  resolve: (result: PermissionResult) => void;
}

interface ChatProcess {
  sessionId: string;
  /** The SDK's handle: an async iterator plus interrupt/setModel/close. */
  session: ReturnType<typeof query>;
  /** Feeds prompts into the SDK's streaming input. */
  push: (text: string) => void;
  /** Ends the input stream, which is what lets the CLI exit cleanly. */
  finish: () => void;
  cwd: string;
  model: string;
  /** Null for a model that takes no effort setting. */
  effort: string | null;
  queued: string[];
  working: boolean;
  starting: boolean;
  turnStartedAt: number | null;
  lastActivityAt: number;
  lastError: string | null;
  /** The question on screen right now, and how to answer it. */
  ask: PendingAsk | null;
  /** Filled from the running session, so the UI offers what this CLI really has. */
  models: ChatModelInfo[];
  commands: string[];
  /**
   * The `claude` process the SDK started. Captured through `spawnClaudeCodeProcess`
   * because nothing else exposes it, and two things need it: excluding ourselves
   * from the two-writers guard (our own run registers a pid file like any other)
   * and killing the tree if it outlives its session.
   */
  pid: number | null;
}

/**
 * A queue an async generator can await: the bridge between HTTP requests
 * arriving whenever they like and the SDK pulling one message at a time.
 */
function messageChannel() {
  const items: string[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  return {
    push(text: string) {
      items.push(text);
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
    async *stream(): AsyncGenerator<{ type: 'user'; message: { role: 'user'; content: string }; parent_tool_use_id: null }> {
      for (;;) {
        while (items.length) {
          const text = items.shift() as string;
          yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null };
        }
        if (closed) return;
        await new Promise<void>((r) => {
          wake = r;
        });
        wake = null;
      }
    },
  };
}

/**
 * Talks to one Claude Code session per conversation, through the Agent SDK.
 *
 * The shape of this is set by one decision: **the answer is not rendered from
 * the SDK's stream.** Claude Code writes its own transcript, the watcher sees
 * the file grow and the viewer re-reads it — the path that already draws every
 * live session. So the message loop is followed only far enough to know when a
 * turn starts and ends, and nothing is accumulated.
 *
 * What the SDK buys over talking to the CLI by hand is the control channel,
 * and specifically `canUseTool`. `AskUserQuestion` does not exist at all in a
 * plain `--print` run (measured: 33 tools without it, 36 with the SDK), so
 * Claude would silently drop to asking in prose. Here the question arrives
 * structured — header, options, descriptions — and is answered from the UI,
 * which is the whole point: the app changes how it looks, not how it behaves.
 */
export class SessionChatService {
  readonly events = new EventEmitter();
  private readonly procs = new Map<string, ChatProcess>();
  /** Last failure per session, kept after the process is gone. */
  private readonly errors = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly index: SessionIndex,
    private readonly settings: () => AppSettings,
  ) {
    // One listener per SSE client, same as the index's emitter.
    this.events.setMaxListeners(100);
  }

  start(): void {
    this.timer = setInterval(() => this.sweep(), TICK_MS);
    this.timer.unref();
  }

  /**
   * Why a prompt cannot be sent, in the words the composer shows. One string
   * for the endpoint and the UI both. A turn already in flight is NOT a reason
   * — that queues.
   */
  sendBlockedReason(sessionId: string): string | null {
    const s = this.settings();
    if (!s.chatEnabled) return 'Sending from the app is turned off in Settings.';
    const summary = this.index.get(sessionId);
    if (!summary) return 'This session is not in the index.';
    if (!findClaudeCli()) return 'The Claude Code CLI could not be found.';
    if (!fs.existsSync(summary.projectPath)) {
      return `The project folder no longer exists: ${summary.projectPath}`;
    }
    // Claude Code appends to the transcript from whatever process holds the
    // session, and two writers is exactly what produces the duplicated uuids
    // and replayed segments the parser has to undo.
    //
    // Our own process is excluded by pid: it registers itself there too. And
    // `pidAlive` is re-checked rather than trusted from the list, which is only
    // rebuilt when something writes to that directory — a CLI killed outright
    // writes nothing on the way out, so its entry would block us forever.
    if (
      this.index.liveSessions.some((l) => l.sessionId === sessionId && !this.ownsPid(l.pid) && pidAlive(l.pid))
    ) {
      return 'This session is open in a terminal — two writers would corrupt its transcript.';
    }
    if (!this.procs.has(sessionId) && this.procs.size >= MAX_CHAT_SESSIONS) {
      return `Too many sessions are already running (${MAX_CHAT_SESSIONS}).`;
    }
    return null;
  }

  status(sessionId: string): ChatStatus {
    const s = this.settings();
    const p = this.procs.get(sessionId);
    const lastError = p?.lastError ?? this.errors.get(sessionId) ?? null;
    let state: ChatState = 'idle';
    if (p?.ask) state = 'asking';
    else if (p?.working) state = p.starting ? 'starting' : 'working';
    else if (lastError) state = 'error';
    const idleCloses =
      p && !p.working ? p.lastActivityAt + Math.max(1, s.chatIdleTimeoutMinutes) * 60_000 : null;
    return {
      sessionId,
      state,
      running: p !== undefined,
      turnStartedAt: p?.turnStartedAt ? new Date(p.turnStartedAt).toISOString() : null,
      idleClosesAt: idleCloses ? new Date(idleCloses).toISOString() : null,
      queued: p?.queued.length ?? 0,
      // What is running, not what would run: the composer picks the starting
      // point from the transcript, which the server would have to parse to know.
      model: p?.model ?? null,
      effort: p?.effort ?? null,
      lastError,
      blockedReason: this.sendBlockedReason(sessionId),
      question: p?.ask?.question ?? null,
      availableModels: p?.models ?? [],
      availableCommands: p?.commands ?? [],
    };
  }

  /**
   * Send one prompt. Starts a session if there is none, queues if a turn is in
   * flight, and switches model or effort live — no restart, which is one of the
   * things the control channel buys.
   */
  async send(sessionId: string, text: string, model?: string, effort?: string | null): Promise<void> {
    const blocked = this.sendBlockedReason(sessionId);
    if (blocked) {
      log.warn(`prompt refused for ${sessionId} — ${blocked}`);
      throw new Error(blocked);
    }
    const prompt = text.trim();
    if (!prompt) throw new Error('The prompt is empty.');
    if (prompt.length > CHAT_MESSAGE_MAX) {
      throw new Error(`The prompt is too long (${prompt.length} > ${CHAT_MESSAGE_MAX} characters).`);
    }

    // The composer always sends both, picked from the last answer in the
    // transcript. These fallbacks are only for a caller that does not — curl,
    // a script — and name what Claude Code itself would default to.
    const wantModel = model ?? this.index.get(sessionId)?.model ?? FALLBACK_MODEL;
    // No effort sent means no effort passed: the CLI then uses whatever that
    // model's own default is, which is the only right answer for one that has none.
    const wantEffort = effort ?? null;

    let p = this.procs.get(sessionId);
    if (p && p.model !== wantModel) {
      // Live, over the control channel. The old code had to kill the process
      // and pay the whole startup again.
      await p.session.setModel(wantModel).catch((err: unknown) => log.warn(`setModel failed`, err));
      p.model = wantModel;
      log.info(`switched ${sessionId} to ${wantModel}`);
    }
    // Effort is a startup flag with no control message, so it still needs a
    // fresh process — but only when it actually changed.
    if (p && p.effort !== wantEffort) {
      if (p.working) throw new Error('Finish the current turn before changing effort.');
      log.info(`restarting ${sessionId} for effort ${wantEffort} (was ${p.effort})`);
      this.kill(p, 'effort changed');
      p = undefined;
    }
    if (!p) p = this.spawnFor(sessionId, wantModel, wantEffort);

    if (p.working) {
      p.queued.push(prompt);
      log.info(`queued a prompt for ${sessionId} (${p.queued.length} waiting)`);
      this.changed(sessionId);
      return;
    }
    this.write(p, prompt);
  }

  /**
   * Answer the question on screen. `values` maps each question text to the
   * label(s) chosen; a null answer denies the tool instead, which is how a
   * permission prompt is refused.
   */
  answer(sessionId: string, values: Record<string, string | string[]> | null): void {
    const p = this.procs.get(sessionId);
    if (!p?.ask) throw new Error('Nothing is waiting for an answer.');
    const { question, resolve } = p.ask;
    p.ask = null;
    p.lastActivityAt = Date.now();
    if (values === null) {
      log.info(`user declined ${question.toolName} in ${sessionId}`);
      resolve({ behavior: 'deny', message: 'The user declined.' });
    } else if (question.questions) {
      // The tool wants its own questions echoed back beside the answers.
      log.info(`user answered ${question.questions.length} question(s) in ${sessionId}`);
      resolve({
        behavior: 'allow',
        updatedInput: { questions: question.questions, answers: values } as Record<string, unknown>,
      });
    } else {
      log.info(`user allowed ${question.toolName} in ${sessionId}`);
      resolve({ behavior: 'allow', updatedInput: (question.input ?? {}) as Record<string, unknown> });
    }
    this.changed(sessionId);
  }

  /** Interrupt the turn and close the session. */
  async stop(sessionId: string): Promise<void> {
    const p = this.procs.get(sessionId);
    if (!p) return;
    // A pending question is holding the turn open; let it go first or the
    // interrupt lands on a loop that is not listening.
    if (p.ask) {
      p.ask.resolve({ behavior: 'deny', message: 'The user stopped the turn.' });
      p.ask = null;
    }
    if (p.working) await p.session.interrupt().catch((err: unknown) => log.warn('interrupt failed', err));
    this.kill(p, 'stopped from the app');
    this.changed(sessionId);
  }

  /**
   * Close every session. Called from the signal handlers and from every route
   * that ends the server: the CLI the SDK spawned is not in this process's tree
   * in any way Windows cleans up for us.
   */
  shutdown(): void {
    if (this.timer) clearInterval(this.timer);
    for (const p of [...this.procs.values()]) this.kill(p, 'the server is shutting down');
  }

  /** True while any session has a turn in flight — the stop/uninstall guard. */
  get busy(): boolean {
    return [...this.procs.values()].some((p) => p.working);
  }

  /** Sessions with a turn in flight — the session list shows these as busy. */
  workingSessions(): Map<string, number> {
    const out = new Map<string, number>();
    for (const p of this.procs.values()) {
      if (p.working) out.set(p.sessionId, p.turnStartedAt ?? Date.now());
    }
    return out;
  }

  private ownsPid(pid: number): boolean {
    for (const p of this.procs.values()) if (p.pid === pid) return true;
    return false;
  }

  // ---- internals ----

  private spawnFor(sessionId: string, model: string, effort: string | null): ChatProcess {
    const cli = findClaudeCli();
    const summary = this.index.get(sessionId);
    if (!cli || !summary) throw new Error('The Claude Code CLI could not be found.');
    const cwd = summary.projectPath;

    const channel = messageChannel();
    const p: ChatProcess = {
      sessionId,
      session: null as unknown as ReturnType<typeof query>,
      push: channel.push,
      finish: channel.close,
      cwd,
      model,
      effort,
      queued: [],
      working: false,
      starting: true,
      turnStartedAt: null,
      lastActivityAt: Date.now(),
      lastError: null,
      ask: null,
      models: [],
      commands: [],
      pid: null,
    };

    p.session = query({
      prompt: channel.stream(),
      options: {
        resume: sessionId,
        cwd,
        model,
        // Omitted entirely for a model that takes none — haiku is one, and
        // handing it an effort is asking for a setting it does not have.
        ...(effort ? { effort: effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max' } : {}),
        // The classifier approves the ordinary work, so canUseTool is only
        // reached by what it will not take — and by AskUserQuestion, which
        // always falls through to it whatever the rules say.
        permissionMode: 'auto',
        // Never the SDK's own vendored copy: that is 293 MB we deliberately do
        // not install, and this is the CLI the user actually runs.
        pathToClaudeCodeExecutable: cli,
        // Strip our own CLAUDE_CODE_* markers, or the child treats itself as a
        // nested session and stops persisting the transcript — the one thing
        // this whole feature depends on.
        env: cleanEnv() as Record<string, string>,
        // Spawn it ourselves purely to learn the pid; everything else is the
        // SDK's own defaults passed straight through.
        spawnClaudeCodeProcess: (opts) => {
          const child = spawn(opts.command, opts.args, {
            cwd: opts.cwd,
            env: opts.env,
            // The SDK's own forwarded signal, which only fires after it has
            // tried stdin-EOF and waited out the grace window. Passing our own
            // would race ahead of that and hard-kill the CLI on Windows.
            signal: opts.signal,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          p.pid = child.pid ?? null;
          log.info(`the claude process for ${sessionId} is pid ${String(p.pid)}`);
          return child as unknown as ReturnType<NonNullable<Parameters<typeof query>[0]['options']>['spawnClaudeCodeProcess'] & object>;
        },
        canUseTool: (toolName, input) => this.onCanUseTool(sessionId, toolName, input),
        stderr: (data: string) => {
          const text = data.trim();
          if (text) log.warn(`${sessionId} wrote to stderr: ${text.slice(0, 300)}`);
        },
      },
    });

    this.procs.set(sessionId, p);
    log.info(
      `started a session for ${sessionId} (${model}${effort ? `, effort ${effort}` : ', no effort — this model takes none'}) in ${cwd}`,
      { cli },
    );
    void this.pump(p);
    return p;
  }

  /**
   * Follow the SDK's messages far enough to track state. The content is
   * already on its way to the viewer through the transcript, so nothing here
   * accumulates or renders.
   */
  private async pump(p: ChatProcess): Promise<void> {
    try {
      for await (const message of p.session) {
        p.lastActivityAt = Date.now();
        p.starting = false;
        if (message.type === 'system' && message.subtype === 'init') {
          // Emitted at the start of EVERY turn, not once at startup, so it
          // cannot mean "ready". Worth reading once: it names the slash
          // commands this CLI actually has, which is what the composer offers
          // instead of a list written here and doomed to drift.
          if (p.commands.length === 0) void this.readCapabilities(p);
          continue;
        }
        if (message.type === 'result') {
          p.working = false;
          p.turnStartedAt = null;
          if (message.subtype !== 'success') {
            p.lastError = `Claude Code reported an error (${message.subtype}).`;
            log.warn(`turn for ${p.sessionId} ended in an error: ${message.subtype}`);
          } else {
            log.info(`turn finished for ${p.sessionId}`);
          }
          const next = p.queued.shift();
          if (next) this.write(p, next);
          else this.changed(p.sessionId);
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') forgetClaudeCli();
      p.lastError = err instanceof Error ? err.message : String(err);
      log.error(`the session for ${p.sessionId} failed`, err);
    } finally {
      p.working = false;
      p.turnStartedAt = null;
      const current = this.procs.get(p.sessionId);
      if (current === p) this.procs.delete(p.sessionId);
      if (p.lastError) this.errors.set(p.sessionId, p.lastError);
      this.changed(p.sessionId);
    }
  }

  /**
   * Ask the running CLI what it offers. Both lists are what make the composer
   * honest: the models are the ones this install accepts (not a constant that
   * ages), and the commands are what `/` should complete to. Failures are
   * logged and dropped — the UI falls back to the shared defaults.
   */
  private async readCapabilities(p: ChatProcess): Promise<void> {
    try {
      // Kept whole: the effort levels are per model (haiku has none at all),
      // and the description is where the version and the 1M context live.
      const models = await p.session.supportedModels();
      p.models = models
        .filter((m) => typeof m.value === 'string' && m.value.length > 0)
        .map((m) => ({
          value: m.value,
          displayName: m.displayName ?? m.value,
          description: m.description ?? '',
          resolvedModel: m.resolvedModel ?? null,
          efforts: m.supportsEffort === false ? [] : (m.supportedEffortLevels ?? []),
        }));
    } catch (err) {
      log.debug(`could not read the model list for ${p.sessionId}`, err);
    }
    try {
      const commands = await p.session.supportedCommands();
      p.commands = commands.map((c) => c.name).filter((n) => typeof n === 'string' && n.length > 0);
    } catch (err) {
      log.debug(`could not read the command list for ${p.sessionId}`, err);
    }
    log.info(`${p.sessionId} offers ${p.models.length} models and ${p.commands.length} commands`);
    this.changed(p.sessionId);
  }

  /**
   * A tool needs the user. In auto mode this is rare — the classifier settles
   * the ordinary work — but `AskUserQuestion` always arrives here, and so does
   * anything the classifier refuses. Either way the promise is held until the
   * browser answers, which is exactly what keeps the turn alive meanwhile.
   */
  private onCanUseTool(sessionId: string, toolName: string, input: Record<string, unknown>): Promise<PermissionResult> {
    const p = this.procs.get(sessionId);
    if (!p) return Promise.resolve({ behavior: 'deny' as const, message: 'The session is gone.' });

    const questions = Array.isArray((input as { questions?: unknown }).questions)
      ? ((input as { questions: ChatQuestion['questions'] }).questions ?? null)
      : null;
    const question: ChatQuestion = {
      toolName,
      questions,
      input: questions ? undefined : input,
      askedAt: new Date().toISOString(),
    };
    log.info(`${toolName} is waiting on the user in ${sessionId}`, { questions: questions?.length ?? 0 });

    return new Promise((resolve) => {
      p.ask = { question, resolve };
      this.changed(sessionId);
    });
  }

  private write(p: ChatProcess, prompt: string): void {
    p.working = true;
    p.turnStartedAt = Date.now();
    p.lastActivityAt = Date.now();
    p.lastError = null;
    this.errors.delete(p.sessionId);
    p.push(prompt);
    log.info(`sent a prompt to ${p.sessionId} (${prompt.length} chars)`);
    this.changed(p.sessionId);
  }

  private sweep(): void {
    const idleMs = Math.max(1, this.settings().chatIdleTimeoutMinutes) * 60_000;
    const now = Date.now();
    for (const p of [...this.procs.values()]) {
      // A question on screen is not silence: the turn is waiting for a person,
      // and killing it would throw away the answer they are about to give.
      if (p.ask) continue;
      const quiet = now - p.lastActivityAt;
      if (p.working) {
        if (quiet > TURN_SILENCE_MS) {
          p.lastError = `The turn produced no output for ${Math.round(TURN_SILENCE_MS / 60_000)} minutes and was stopped.`;
          log.warn(`turn for ${p.sessionId} went silent — closing it`);
          this.kill(p, 'the turn went silent');
          this.changed(p.sessionId);
        }
        continue;
      }
      if (quiet > idleMs) {
        log.info(`closing the idle session for ${p.sessionId}`);
        this.kill(p, 'idle');
        this.changed(p.sessionId);
      }
    }
  }

  /**
   * Close a session for good. `close()` ends the SDK's side; ending the input
   * stream is what lets the CLI exit on EOF, which it does on its own. The
   * taskkill is the belt-and-braces for a child that ignores both — `claude`
   * spawns children of its own, so it takes the tree.
   */
  private kill(p: ChatProcess, why: string): void {
    this.procs.delete(p.sessionId);
    if (p.lastError) this.errors.set(p.sessionId, p.lastError);
    if (p.ask) {
      p.ask.resolve({ behavior: 'deny', message: 'The session was closed.' });
      p.ask = null;
    }
    log.info(`closing the session for ${p.sessionId} — ${why}`);
    try {
      p.finish();
      p.session.close();
    } catch (err) {
      log.warn(`could not close the SDK session for ${p.sessionId}`, err);
    }
    if (p.pid !== null) {
      try {
        spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true });
      } catch (err) {
        log.warn(`taskkill failed for ${p.sessionId}`, err);
      }
    }
  }

  private changed(sessionId: string): void {
    this.events.emit('chat-changed', sessionId);
  }
}
