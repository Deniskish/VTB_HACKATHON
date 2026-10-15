// Подключаем тему и запускаем React.
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './business/styles/ui-kit.css';
import '@fontsource-variable/manrope';
import App from './App';
import { UiRoot } from './business/UiControls';
import { installViewportSizing } from './viewport';
import { installTheme, useSystemTheme } from './theme';
import './index.css';
installTheme();
function ThemedApp() {
  const theme = useSystemTheme();
  useEffect(installViewportSizing, []);
  return <UiRoot colorScheme={theme} className={`opora-theme theme-${theme}`}><App /></UiRoot>;
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemedApp />
  </StrictMode>,
);
