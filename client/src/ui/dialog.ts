// Модальное окно выбора: «В кого превратить?», «Что делать с городом?».

export interface ChoiceOption<T> {
  value: T;
  label: string;
  description: string;
  /** Причина, по которой вариант недоступен. */
  disabledReason?: string | null;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function showChoice<T>(title: string, text: string, options: ChoiceOption<T>[], onPick: (value: T) => void): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="panel modal choice">
      <h1>${esc(title)}</h1>
      ${text ? `<p class="text">${esc(text)}</p>` : ''}
      <div class="options">
        ${options
          .map(
            (o, i) => `<button data-i="${i}" ${o.disabledReason ? 'disabled' : ''}>
              <b>${esc(o.label)}</b><span>${esc(o.disabledReason ?? o.description)}</span>
            </button>`,
          )
          .join('')}
      </div>
      <button class="cancel">Отмена (Esc)</button>
    </div>`;
  const close = () => {
    backdrop.remove();
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  window.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target === backdrop || target.closest('.cancel')) return close();
    const btn = target.closest<HTMLButtonElement>('button[data-i]');
    if (!btn || btn.disabled) return;
    close();
    onPick(options[Number(btn.dataset.i)].value);
  });
  document.body.appendChild(backdrop);
}
