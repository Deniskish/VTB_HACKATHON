// Базовые элементы управления на нативных button/input/textarea. Внешний вид задают
// ui-kit.css (основа) и ui-controls.css (тема Опоры).
import React, { useEffect, useRef } from 'react';

// iOS получает подсветку нажатия, остальные платформы — волну (ripple).
export const uiPlatform: 'ios' | 'android' =
  typeof navigator !== 'undefined' && /(iPad|iPhone|iPod)/.test(navigator.userAgent) ? 'ios' : 'android';
const classes = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ');

/** Корневой контейнер: переменные темы элементов управления для выбранной схемы. */
export function UiRoot({ colorScheme, className = '', children }: { colorScheme: 'light' | 'dark'; className?: string; children: React.ReactNode }) {
  return <div className={classes('ui-root', `ui-scheme-${colorScheme}`, `ui-platform-${uiPlatform}`, className)}>{children}</div>;
}

function Ripple() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const ripple = ref.current, host = ripple?.parentElement;
    if (!ripple || !host) return;
    const start = (event: PointerEvent) => {
      const box = host.getBoundingClientRect();
      ripple.classList.remove('ui-ripple--active');
      ripple.style.top = `${event.clientY - box.top}px`;
      ripple.style.left = `${event.clientX - box.left}px`;
      ripple.classList.add('ui-ripple--active');
    };
    host.addEventListener('pointerdown', start);
    return () => host.removeEventListener('pointerdown', start);
  }, []);
  return <span ref={ref} role="presentation" aria-hidden className="ui-ripple ui-button__ripple"
    onAnimationEnd={() => ref.current?.classList.remove('ui-ripple--active')} />;
}

/** Pointer focus is not keyboard focus; keep the latter available after Tab/keyboard activation. */
export function IconButton({ className = '', type = 'button', onPointerDown, onKeyDown, onBlur,
  ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} type={type} className={`opora-icon-action ${className}`}
    onPointerDown={event => { event.currentTarget.dataset.pointerFocus = 'true'; onPointerDown?.(event); }}
    onKeyDown={event => { delete event.currentTarget.dataset.pointerFocus; onKeyDown?.(event); }}
    onBlur={event => { delete event.currentTarget.dataset.pointerFocus; onBlur?.(event); }} />;
}

// Вариант кнопки выводится из классов темы, как и раньше.
export function ActionButton({ className = '', type = 'button', disabled = false, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const variant =
    className.includes('primary') || className.includes('lime-button')
      ? 'primary'
      : className.includes('secondary')
        ? 'secondary'
        : 'ghost';
  const ripple = !disabled && uiPlatform === 'android';
  return (
    <button
      {...props}
      type={type}
      disabled={disabled}
      className={classes('ui-button', `ui-button--${variant}`, 'ui-button--small', disabled && 'ui-button--disabled',
        !disabled && (ripple ? 'ui-button--ripple' : 'ui-button--highlight'), `opora-action ${className}`)}
    >
      <span className="ui-ellipsis ui-ellipsis--single-line ui-button__content opora-action-content">{children}</span>
      {ripple && <Ripple />}
    </button>
  );
}
export function BusinessInput({ className = '', iconBefore, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { iconBefore?: React.ReactNode }) {
  return (
    <div className="opora-input">
      <label className={classes('ui-input', 'ui-input--medium', props.disabled && 'ui-input--disabled', `opora-input-control ${className}`)}>
        {iconBefore && <div className="ui-input__icon-before">{iconBefore}</div>}
        <span className="ui-input__clearable ui-input__body opora-input-body">
          <input {...props} className="ui-input__field opora-native-input" />
        </span>
      </label>
    </div>
  );
}
export function BusinessTextarea({ className: _className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div className={classes('ui-textarea', 'ui-textarea--primary', props.disabled && 'ui-textarea--disabled', 'opora-textarea')}>
      <textarea {...props} className="ui-textarea__field opora-native-textarea" />
    </div>
  );
}
