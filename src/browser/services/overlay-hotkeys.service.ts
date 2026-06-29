import { app } from 'electron';
import { overwolf } from '@overwolf/ow-electron';
import { IOverwolfOverlayApi } from '@overwolf/ow-electron-packages-types';
import EventEmitter from 'events';
import { OverlayService } from './overlay.service';

const owElectron = app as overwolf.OverwolfApp;

/**
 * Registra el/los hotkeys in-game del overlay.
 * Debe instalarse despues de que el paquete 'overlay' este listo.
 */
export class OverlayHotkeysService extends EventEmitter {
  constructor(overlayService: OverlayService) {
    super();
    overlayService.on('ready', this.installHotKeys.bind(this));
  }

  /** Reservado para customizar el hotkey mas adelante. */
  public updateHotkey() {
    this.log('updateHotkey: todavia no implementado');
  }

  private installHotKeys() {
    if (!this.overlayApi) {
      this.log('no se pudo instalar hotkeys: overlayApi null');
      return;
    }

    // Ctrl+Shift+A -> mostrar/ocultar el overlay del coach (in-game).
    this.overlayApi.hotkeys.register(
      {
        name: 'toggleAimCoachOverlay',
        keyCode: 65, // A
        modifiers: { ctrl: true, shift: true },
        passthrough: true,
      },
      (hotkey, state) => {
        if (state === 'pressed') this.toggleOverlay();
      }
    );

    this.log('hotkey registrado: Ctrl+Shift+A para mostrar/ocultar el overlay');
  }

  private toggleOverlay() {
    const windows = this.overlayApi?.getAllWindows() ?? [];
    if (!windows.length) {
      this.log('toggle: no hay overlay todavia (entra a una partida primero)');
      return;
    }
    windows.forEach((w) => {
      if (w.window.isVisible()) {
        w.window.hide();
      } else {
        w.window.show();
      }
    });
    this.log('overlay toggled');
  }

  private log(message: string, ...args: any[]) {
    this.emit('log', message, ...args);
  }

  get overlayApi(): IOverwolfOverlayApi {
    return (owElectron.overwolf.packages as any).overlay as IOverwolfOverlayApi;
  }
}
