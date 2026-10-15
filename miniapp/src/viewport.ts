// Mobile viewport: follow the visual viewport and shrink for the on-screen keyboard.
export function installViewportSizing() {
  const viewport = window.visualViewport;
  let frame = 0;
  let disposed = false;

  const render = () => {
    if (disposed || (viewport && viewport.scale !== 1)) return;
    const active = document.activeElement;
    const editing = active instanceof HTMLElement &&
      active.matches('input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"]');
    const height = viewport?.height ?? window.innerHeight;
    document.documentElement.style.setProperty('--app-height', `${height}px`);
    if (editing) {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (document.activeElement === active) active.scrollIntoView({ block: 'nearest' });
      });
    }
  };

  const onFocus = () => {
    // focusout fires before document.activeElement has settled.
    queueMicrotask(render);
  };
  render();
  viewport?.addEventListener('resize', render);
  window.addEventListener('resize', render);
  window.addEventListener('pageshow', render);
  document.addEventListener('focusin', onFocus);
  document.addEventListener('focusout', onFocus);
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    viewport?.removeEventListener('resize', render);
    window.removeEventListener('resize', render);
    window.removeEventListener('pageshow', render);
    document.removeEventListener('focusin', onFocus);
    document.removeEventListener('focusout', onFocus);
  };
}
