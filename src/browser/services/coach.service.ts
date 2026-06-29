import { app as electronApp } from 'electron';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import WebSocket from 'ws';
import { overwolf } from '@overwolf/ow-electron';
import { OverlayService } from './overlay.service';

const { AimCoachEngine } = require('../engine/ruleEngine');

const owElectronApp = electronApp as overwolf.OverwolfApp;

const VALORANT_ID = 21640;
const GEP_FEATURES = ['match_info', 'me', 'game_info', 'kill', 'death'];
const CAPTURER_WS = 'ws://127.0.0.1:9595/';

export class CoachService {
  private engine: any;
  private overlayWindow: any = null;
  private capturer: ChildProcess | null = null;
  private gepApi: any = null;
  private overlayRegistered = false;

  constructor(private readonly overlayService: OverlayService) {
    this.engine = new AimCoachEngine({
      onFeedback: (f: any) => this.showFeedback(f)
    });
  }

  public start() {
    this.initOverlay();
    this.initGep();
    this.startCapturer();
    this.connectMouseStream();
  }

  private initOverlay() {
    this.overlayService.on('injection-decision-handling', (event: any) => {
      event.inject();
    });

    this.overlayService.on('ready', async () => {
      if (this.overlayRegistered) return;
      this.overlayRegistered = true;

      await this.overlayService.registerToGames([VALORANT_ID]);
      console.log('COACH: overlay registered for Valorant');

      const api = this.overlayService.overlayApi;
      if (!api) {
        console.log('COACH: overlayApi null after ready');
        return;
      }
      api.on('game-injected', () => {
        console.log('COACH: game injected, creating overlay window');
        this.createOverlayWindow();
      });
    });
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
      console.log('COACH: overlay window created');
    } catch (err: any) {
      console.log('COACH: createOverlayWindow error', err && err.message);
    }
  }

  private initGep() {
    owElectronApp.overwolf.packages.on('ready', (e: any, packageName: string) => {
      if (packageName !== 'gep') return;
      this.gepApi = (owElectronApp.overwolf.packages as any).gep;
      if (!this.gepApi) {
        console.log('COACH: gep api null at ready');
        return;
      }
      this.gepApi.removeAllListeners();

      this.gepApi.on('game-detected', (event: any, gameId: number) => {
        if (gameId !== VALORANT_ID) return;
        console.log('COACH: Valorant detected, enabling GEP');
        event.enable();
        this.gepApi.setRequiredFeatures(VALORANT_ID, GEP_FEATURES);
      });

      this.gepApi.on('new-info-update', (e2: any, gameId: number, ...args: any[]) => {
        if (gameId === VALORANT_ID) this.handleInfoUpdate(args);
      });

      this.gepApi.on('new-game-event', (e2: any, gameId: number, ...args: any[]) => {
        if (gameId === VALORANT_ID) this.handleGameEvent(args);
      });

      this.gepApi.on('error', (e2: any, gameId: number, error: any) =>
        console.log('COACH: GEP error', error)
      );
    });
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
    try {
      this.capturer = spawn(exe, [], { windowsHide: true });
      this.capturer.on('error', (err: any) =>
        console.log('COACH: capturer spawn error', err && err.message)
      );
      this.capturer.on('exit', () => {
        this.capturer = null;
      });
    } catch (err: any) {
      console.log('COACH: capturer spawn threw', err && err.message);
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
    ws.on('message', (data: any) => {
      try {
        this.engine.pushMouse(JSON.parse(data.toString()));
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
