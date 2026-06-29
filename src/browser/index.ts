import { app as ElectronApp } from 'electron';
import { OverlayService } from './services/overlay.service';
import { CoachService } from './services/coach.service';

const bootstrap = (): CoachService => {
  const overlayService = new OverlayService();
  const coachService = new CoachService(overlayService);
  return coachService;
};

const coach = bootstrap();

ElectronApp.whenReady().then(() => {
  coach.start();
});

ElectronApp.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    ElectronApp.quit();
  }
});
