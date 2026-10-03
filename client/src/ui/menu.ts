// Вход, главное меню и меню партии: продолжить, новая партия, сохранить и загрузить (слоты,
// экспорт и импорт файла), настройки.

import { nationDef, type GameState } from '../core';
import { apiLogin, loginProblem, saveIdentity, type Identity } from '../net/analytics';
import { SaveError, readSaveFile, writeSaveFile, type SaveMeta } from '../save/format';
import { AUTO_SLOT, MANUAL_SLOTS, type SaveStore, type SlotId } from '../save/storage';
import { esc } from './dialog';
import type { Settings } from './settings';

export interface MenuHost {
  saves: SaveStore;
  identity(): Identity | null;
  /** Текущая партия или null, если её ещё нет. */
  current(): GameState | null;
  newGame(): void;
  load(state: GameState): void;
  settings(): Settings;
  applySettings(settings: Settings): void;
  /** Показать короткое сообщение. */
  notify(text: string): void;
}

interface Modal {
  root: HTMLElement;
  close(): void;
}

/** Модальное окно: клик по фону и Esc закрывают (если можно), обработчик кликов — по data-action. */
function openModal(html: string, onAction: (action: string, el: HTMLElement, modal: Modal) => void, closable = true): Modal {
  const root = document.createElement('div');
  root.className = 'modal-backdrop';
  root.innerHTML = html;
  const onKey = (e: KeyboardEvent) => {
    const all = document.querySelectorAll('.modal-backdrop');
    if (e.key !== 'Escape' || !closable || all[all.length - 1] !== root) return;
    e.stopPropagation();
    modal.close();
  };
  const modal: Modal = {
    root,
    close() {
      root.remove();
      window.removeEventListener('keydown', onKey, true);
    },
  };
  root.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    if (el === root && closable) return modal.close();
    const btn = el.closest<HTMLElement>('[data-action]');
    if (btn && !(btn as HTMLButtonElement).disabled) onAction(btn.dataset.action!, btn, modal);
  });
  window.addEventListener('keydown', onKey, true);
  document.body.appendChild(root);
  return modal;
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function metaLine(meta: SaveMeta): string {
  return `<span class="swatch" style="background:${meta.color}"></span>${esc(meta.power)} · ход ${meta.turn} · держав ${meta.powers}${meta.finished ? ' · партия окончена' : ''} · <span class="muted">${esc(fmtDate(meta.savedAt))}</span>`;
}

// ---------- Вход ----------

/**
 * Экран «Введи имя игрока». Логин запоминается в браузере; второй раз вход не спрашивается.
 * Сервер недоступен — игра всё равно начинается (статистика просто не пишется).
 */
export function showLogin(current: Identity | null, onDone: (identity: Identity) => void): void {
  const modal = openModal(
    `<div class="panel modal login">
      <h1>${current ? 'Сменить имя' : 'Введи имя игрока'}</h1>
      <input id="login" maxlength="20" autocomplete="nickname" spellcheck="false" value="${esc(current?.login ?? '')}" placeholder="например, denis_42" />
      <div class="reason" id="login-error"></div>
      <button class="start" data-action="go">${current ? 'Сохранить' : 'Играть'}</button>
      ${current ? '<button class="start secondary" data-action="cancel">Отмена</button>' : ''}
      <div class="hint">3–20 символов: буквы, цифры, «_». Пароля нет. Мы сохраняем имя, страну и время входа, а также
      начало и итог партий — для статистики игры. <a href="/privacy" target="_blank" rel="noopener">Подробнее</a></div>
    </div>`,
    (action, _el, m) => {
      if (action === 'cancel') m.close();
      if (action === 'go') void submit();
    },
    !!current,
  );
  const input = modal.root.querySelector<HTMLInputElement>('#login')!;
  const error = modal.root.querySelector<HTMLElement>('#login-error')!;
  const button = modal.root.querySelector<HTMLButtonElement>('[data-action="go"]')!;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void submit();
  });
  setTimeout(() => input.focus(), 0);
  async function submit(): Promise<void> {
    const login = input.value.trim();
    const problem = loginProblem(login);
    error.textContent = problem ?? '';
    if (problem) return;
    button.disabled = true;
    const identity = saveIdentity(login);
    const res = await apiLogin(identity);
    button.disabled = false;
    if (res.status === 'rejected') {
      error.textContent = res.reason;
      return;
    }
    modal.close();
    onDone(identity);
  }
}

// ---------- Главное меню ----------

/** Главное меню. inGame — открыто из партии (можно вернуться к ней). */
export function showMainMenu(host: MenuHost, inGame: boolean): void {
  const auto = host.saves.list()[AUTO_SLOT];
  const canContinue = !inGame && auto && !auto.finished;
  const identity = host.identity();
  const current = host.current();
  openModal(
    `<div class="panel modal menu">
      <h1>Цивилизация</h1>
      ${identity ? `<div class="row"><span class="muted">Игрок: <b>${esc(identity.login)}</b></span><button class="link" data-action="login">сменить</button></div>` : ''}
      <div class="options">
        ${inGame ? '<button data-action="close"><b>Вернуться к партии</b><span>Esc</span></button>' : ''}
        ${canContinue ? `<button data-action="continue"><b>Продолжить</b><span>${metaLine(auto)}</span></button>` : ''}
        <button data-action="new"><b>Новая партия</b><span>нация, число держав, сложность, сид карты</span></button>
        ${inGame && current ? '<button data-action="save"><b>Сохранить</b><span>в слот или в файл</span></button>' : ''}
        <button data-action="load"><b>Загрузить</b><span>из слота или из файла</span></button>
        <button data-action="settings"><b>Настройки</b><span>простая графика</span></button>
      </div>
      ${host.saves.available ? '' : '<div class="reason">Браузер не даёт сохранять данные на этом сайте — сохранения недоступны.</div>'}
    </div>`,
    async (action, _el, m) => {
      if (action === 'close') m.close();
      else if (action === 'continue') {
        try {
          const state = await host.saves.load(AUTO_SLOT);
          m.close();
          host.load(state);
        } catch (err) {
          host.notify(err instanceof SaveError ? err.message : 'Не удалось загрузить партию');
        }
      } else if (action === 'new') {
        m.close();
        host.newGame();
      } else if (action === 'save') showSaveDialog(host);
      else if (action === 'load') showLoadDialog(host, () => m.close());
      else if (action === 'settings') showSettingsDialog(host);
      else if (action === 'login') {
        showLogin(identity, () => {
          m.close();
          showMainMenu(host, inGame);
        });
      }
    },
    inGame,
  );
}

// ---------- Сохранение и загрузка ----------

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportFileName(state: GameState): string {
  const nation = state.powers[state.humanPower].nationId;
  return `civ-${nation}-turn${state.turn}.json`;
}

export function showSaveDialog(host: MenuHost): void {
  const state = host.current();
  if (!state) return;
  const render = () => {
    const list = host.saves.list();
    return `<div class="panel modal menu saves">
      <h1>Сохранить партию</h1>
      <div class="muted small">${esc(nationDef(state.powers[state.humanPower].nationId).name)}, ход ${state.turn}. Автосохранение — в конце каждого хода.</div>
      <div class="slots">
        ${MANUAL_SLOTS.map((slot) => {
          const meta = list[slot];
          return `<div class="slot"><div><b>Слот ${slot}</b><div class="small">${meta ? metaLine(meta) : '<span class="muted">пусто</span>'}</div></div>
            <button data-action="save" data-slot="${slot}">${meta ? 'Перезаписать' : 'Сохранить'}</button></div>`;
        }).join('')}
      </div>
      <button class="start secondary" data-action="export">Экспорт в файл</button>
      <button class="start secondary" data-action="close">Закрыть</button>
    </div>`;
  };
  openModal(render(), async (action, el, m) => {
    if (action === 'close') m.close();
    else if (action === 'export') download(exportFileName(state), writeSaveFile(state));
    else if (action === 'save') {
      try {
        await host.saves.save(el.dataset.slot as SlotId, state);
        host.notify(`Сохранено в слот ${el.dataset.slot}`);
        m.root.innerHTML = render();
      } catch (err) {
        host.notify(err instanceof SaveError ? err.message : 'Не удалось сохранить');
      }
    }
  });
}

/** Загрузка: слоты и импорт файла. onLoaded — закрыть то, что открыло это окно. */
export function showLoadDialog(host: MenuHost, onLoaded: () => void): void {
  const render = () => {
    const list = host.saves.list();
    const slots: SlotId[] = [AUTO_SLOT, ...MANUAL_SLOTS];
    return `<div class="panel modal menu saves">
      <h1>Загрузить партию</h1>
      <div class="slots">
        ${slots
          .map((slot) => {
            const meta = list[slot];
            const name = slot === AUTO_SLOT ? 'Автосохранение' : `Слот ${slot}`;
            return `<div class="slot"><div><b>${name}</b><div class="small">${meta ? metaLine(meta) : '<span class="muted">пусто</span>'}</div></div>
              <div class="slot-actions">
                <button data-action="load" data-slot="${slot}" ${meta ? '' : 'disabled'}>Загрузить</button>
                ${meta ? `<button class="link" data-action="delete" data-slot="${slot}" title="Удалить">✕</button>` : ''}
              </div></div>`;
          })
          .join('')}
      </div>
      <button class="start secondary" data-action="import">Импорт из файла…</button>
      <button class="start secondary" data-action="close">Закрыть</button>
      <input type="file" accept=".json,application/json" hidden />
    </div>`;
  };
  const modal = openModal(render(), async (action, el, m) => {
    if (action === 'close') m.close();
    else if (action === 'delete') {
      host.saves.remove(el.dataset.slot as SlotId);
      m.root.innerHTML = render();
      bindFile();
    } else if (action === 'import') m.root.querySelector<HTMLInputElement>('input[type=file]')!.click();
    else if (action === 'load') {
      try {
        const state = await host.saves.load(el.dataset.slot as SlotId);
        finish(state);
      } catch (err) {
        host.notify(err instanceof SaveError ? err.message : 'Не удалось загрузить');
      }
    }
  });
  const finish = (state: GameState) => {
    modal.close();
    onLoaded();
    host.load(state);
  };
  const bindFile = () => {
    const input = modal.root.querySelector<HTMLInputElement>('input[type=file]')!;
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        finish(readSaveFile(await file.text()));
      } catch (err) {
        host.notify(err instanceof SaveError ? err.message : 'Не удалось прочитать файл');
      }
      input.value = '';
    });
  };
  bindFile();
}

// ---------- Настройки ----------

export function showSettingsDialog(host: MenuHost): void {
  const s = host.settings();
  const modal = openModal(
    `<div class="panel modal menu">
      <h1>Настройки</h1>
      <label class="check"><input type="checkbox" id="simple" ${s.simpleGraphics ? 'checked' : ''} />
        Простая графика <span class="muted small">— плоские гексы без граней, теней и объёма; легче для слабых компьютеров</span></label>
      <button class="start secondary" data-action="close">Закрыть</button>
    </div>`,
    (action, _el, m) => {
      if (action === 'close') m.close();
    },
  );
  modal.root.querySelector<HTMLInputElement>('#simple')!.addEventListener('change', (e) => {
    host.applySettings({ ...host.settings(), simpleGraphics: (e.target as HTMLInputElement).checked });
  });
}
