import { app as electronApp } from 'electron';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import WebSocket from 'ws';
import { overwolf } from '@overwolf/ow-electron';
import EventEmitter from 'events';
import { OverlayService } from './overlay.service';

const { AimCoachEngine } = require('../engine/ruleEngine');

const owElectronApp = electronApp as overwolf.OverwolfApp;

const VALORANT_ID = 21640;
const GEP_FEATURES = ['game_info', 'me', 'match_info', 'kill', 'death', 'gep_internal'];
const CAPTURER_WS = 'ws://127.0.0.1:9595/';

export class CoachService extends EventEmitter {
  private engine: any;
  private overlayWindow: any = null;
  private capturer: ChildProcess | null = null;
  private gepApi: any = null;
  private overlayRegistered = false;

  // contadores/heartbeat para poder VER que la captura esta viva (sin floodear el log)
  private gepCount = 0;
  private lastGepLog = 0;
  private mouseCount = 0;
  private lastMouseLog = 0;

  constructor(private readonly overlayService: OverlayService) {
    super();
    this.engine = new AimCoachEngine({
      onFeedback: (f: any) => this.showFeedback(f)
    });
  }

  public start() {
    this.log('COACH: start');
    this.initOverlay();
    this.initGep();
    this.startCapturer();
    this.connectMouseStream();
  }

  /** Emite a la ventana de config (y consola) — el console.log del main no se ve en la terminal de Windows. */
  private log(message: string, ...args: any[]) {
    console.log(message, ...args);
    this.emit('log', message, ...args);
  }

  private initOverlay() {
    this.overlayService.on('injection-decision-handling', (event: any, gameInfo: any) => {
      this.log('COACH: injecting into ' + (gameInfo?.name ?? 'game'));
      event.inject();
    });

    this.overlayService.on('ready', async () => {
      if (this.overlayRegistered) return;
      this.overlayRegistered = true;

      await this.overlayService.registerToGames([VALORANT_ID]);
      this.log('COACH: overlay registered for Valorant');

      const api = this.overlayService.overlayApi;
      if (!api) {
        this.log('COACH: overlayApi null after ready');
        return;
      }
      api.on('game-injected', () => {
        this.log('COACH: game injected, creating overlay window');
        this.createOverlayWindow();
      });
    });
  }

  /** Crea el overlay si no existe; si ya existe, lo muestra. (Solo funciona con un juego inyectado.) */
  public async showOverlay() {
    if (this.overlayWindow && !this.overlayWindow.window.isDestroyed()) {
      this.overlayWindow.window.show();
      this.log('COACH: overlay mostrado');
      return;
    }
    if (!this.overlayService.overlayApi) {
      this.log(
        'COACH: el paquete overlay todavia no esta listo. El overlay vive DENTRO de un juego — ' +
        'abrí Valorant (Windowed/Borderless) y se crea solo al inyectar.'
      );
      return;
    }
    await this.createOverlayWindow();
  }

  /** Muestra/oculta el overlay si ya existe. */
  public toggleOverlay() {
    if (!this.overlayWindow || this.overlayWindow.window.isDestroyed()) {
      this.log('COACH: toggle sin overlay (crealo o entra a una partida)');
      return;
    }
    const w = this.overlayWindow.window;
    if (w.isVisible()) {
      w.hide();
    } else {
      w.show();
    }
  }

  private async createOverlayWindow() {
    const options: any = {
      name: 'aimcoach-overlay',
      width: 460,
      height: 220,
      x: 40,
      y: 40,
      show: true,
      transparent: true,
      resizable: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    };
    try {
      this.overlayWindow = await this.overlayService.createNewOsrWindow(options);
      await this.overlayWindow.window.loadFile(
        path.join(__dirname, '../renderer/overlay.html')
      );
      this.overlayWindow.window.show();
      this.overlayWindow.window.setIgnoreMouseEvents(true);
      this.log('COACH: overlay window created');
    } catch (err: any) {
      this.log('COACH: createOverlayWindow error', err && err.message);
    }
  }

  private initGep() {
    owElectronApp.overwolf.packages.on('ready', (e: any, packageName: string, version: string) => {
      if (packageName !== 'gep') return;
      this.log('GEP: package ready v' + version);
      this.gepApi = (owElectronApp.overwolf.packages as any).gep;
      if (!this.gepApi) {
        this.log('GEP: api null at ready');
        return;
      }
      this.gepApi.removeAllListeners();

      this.gepApi.on('game-detected', (event: any, gameId: number, name: string) => {
        this.log('GEP: game-detected ' + gameId + ' (' + name + ')');
        if (gameId !== VALORANT_ID) {
          this.log('GEP: no es Valorant (' + VALORANT_ID + '), ignorando');
          return;
        }
        this.log('GEP: Valorant detectado -> enable + setRequiredFeatures');
        event.enable();
        this.gepApi
          .setRequiredFeatures(VALORANT_ID, GEP_FEATURES)
          .then(() => this.log('GEP: setRequiredFeatures OK -> ' + GEP_FEATURES.join(', ')))
          .catch((err: any) => this.log('GEP: setRequiredFeatures ERROR ' + (err?.message ?? err)));
      });

      // Valorant corre elevado: si la app no es admin, GEP avisa por aca.
      this.gepApi.on('elevated-privileges-required', (e2: any, gameId: number) => {
        this.log('GEP: elevated-privileges-required (' + gameId + ') -> CORRÉ LA APP COMO ADMINISTRADOR');
      });

      this.gepApi.on('new-info-update', (e2: any, gameId: number, ...args: any[]) => {
        if (gameId !== VALORANT_ID) return;
        this.heartbeatGep('info-update', args);
        this.handleInfoUpdate(args);
      });

      this.gepApi.on('new-game-event', (e2: any, gameId: number, ...args: any[]) => {
        if (gameId !== VALORANT_ID) return;
        this.heartbeatGep('game-event', args);
        this.handleGameEvent(args);
      });

      this.gepApi.on('error', (e2: any, gameId: number, error: any) =>
        this.log('GEP error ' + (error?.message ?? JSON.stringify(error)))
      );

      // @ts-ignore evento de salida del juego (no tipado)
      this.gepApi.on('game-exit', (e2: any, gameId: number) =>
        this.log('GEP: game-exit ' + gameId)
      );
    });
  }

  // Loguea que la captura de Valorant esta viva, con throttle de 2s y un preview del payload.
  private heartbeatGep(kind: string, args: any[]) {
    this.gepCount++;
    const now = Date.now();
    if (now - this.lastGepLog < 2000) return;
    this.lastGepLog = now;
    let preview = '';
    try { preview = JSON.stringify(args).slice(0, 180); } catch (_) {}
    this.log(`GEP: capturando Valorant (${this.gepCount} updates) ultimo ${kind}: ${preview}`);
  }

  private handleInfoUpdate(args: any[]) {
    const payload =
      args.find(a => a && a.match_info) || (args[0] && args[0].info) || args[0];
    const mi = payload && payload.match_info ? payload.match_info : null;
    if (!mi) return;
    for (const key of Object.keys(mi)) {
      if (key.startsWith('scoreboard_')) {
        try {
          const row = JSON.parse(mi[key]);
          if (row.is_local && row.weapon) {
            this.engine.setWeapon(this.cleanWeapon(row.weapon));
          }
        } catch (_) {}
      }
    }
    if (mi.round_number) this.engine.setPhase('active');
  }

  private handleGameEvent(args: any[]) {
    const ev = args.find(a => a && a.name) || args[0];
    if (!ev || !ev.name) return;
    if (ev.name === 'match_info' && ev.data) this.tryRoundReport(ev.data);
    if (ev.name === 'death') this.engine.setPhase('dead');
    if (ev.name === 'match_end') this.engine.setPhase('roundEnd');
  }

  private tryRoundReport(data: any) {
    try {
      const obj = typeof data === 'string' ? JSON.parse(data) : data;
      const rr =
        obj.round_report || (obj.match_info && obj.match_info.round_report);
      if (rr) {
        this.engine.pushRoundReport(
          typeof rr === 'string' ? JSON.parse(rr) : rr
        );
      }
    } catch (_) {}
  }

  private cleanWeapon(internal: string): string {
    const parts = internal.split('_');
    return parts[parts.length - 1];
  }

  private resolveCapturerPath(): string {
    if (electronApp.isPackaged) {
      return path.join(process.resourcesPath, 'native', 'MouseCapturer.exe');
    }
    return path.join(__dirname, '../../native/publish/MouseCapturer.exe');
  }

  private startCapturer() {
    const exe = this.resolveCapturerPath();
    this.log('CAPTURER: lanzando ' + exe);
    try {
      this.capturer = spawn(exe, [], { windowsHide: true });
      this.capturer.on('error', (err: any) =>
        this.log('CAPTURER: spawn error ' + (err && err.message))
      );
      this.capturer.on('exit', (code: any) => {
        this.log('CAPTURER: proceso terminó (code ' + code + ')');
        this.capturer = null;
      });
    } catch (err: any) {
      this.log('CAPTURER: spawn threw ' + (err && err.message));
    }
  }

  private connectMouseStream() {
    let ws: WebSocket;
    try {
      ws = new WebSocket(CAPTURER_WS);
    } catch (_) {
      setTimeout(() => this.connectMouseStream(), 1500);
      return;
    }
    ws.on('open', () => this.log('CAPTURER: WebSocket conectado (' + CAPTURER_WS + ') — stream de mouse activo'));
    ws.on('message', (data: any) => {
      try {
        this.engine.pushMouse(JSON.parse(data.toString()));
        this.mouseCount++;
        const now = Date.now();
        if (now - this.lastMouseLog > 3000) {
          this.lastMouseLog = now;
          this.log('CAPTURER: ' + this.mouseCount + ' eventos de mouse recibidos');
        }
      } catch (_) {}
    });
    ws.on('close', () => setTimeout(() => this.connectMouseStream(), 1500));
    ws.on('error', () => {
      try {
        ws.close();
      } catch (_) {}
    });
  }

  public setBaseline(baseline: any) {
    this.engine.setBaseline(baseline);
  }

  private showFeedback(feedback: any) {
    if (this.overlayWindow && !this.overlayWindow.window.isDestroyed()) {
      this.overlayWindow.window.webContents.send('feedback', feedback);
    }
  }
}
