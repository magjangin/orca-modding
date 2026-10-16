// 입력창 아래 줄의 펼침 메뉴(모델·노력·권한·핑퐁). index.html에는 빈 .custom-dropdown-wrap만 두고 여기서 채운다.
import { $, esc } from './core.js'

const CARET =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const CHECK_ICON =
  '<svg class="check-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 13 4 4L19 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'

function setOpen(wrap, open) {
  wrap.classList.toggle('open', open)
  wrap.querySelector('.custom-select-btn').setAttribute('aria-expanded', String(open))
}

// 열린 메뉴를 모두 닫고, 닫은 게 있었는지 돌려준다 (Esc가 응답 멈추기보다 먼저 메뉴를 닫게).
export function closeDropdowns(except) {
  let closed = false
  document.querySelectorAll('.custom-dropdown-wrap.open').forEach((w) => {
    if (w === except) return
    setOpen(w, false)
    closed = true
  })
  return closed
}

document.addEventListener('click', (e) => {
  closeDropdowns(e.target.closest('.custom-dropdown-wrap'))
})

/**
 * @param {string} name  `#<name>-dropdown-wrap`
 * @param {{icon:string, title:string, prefix?:string, alignRight?:boolean, onPick:(id:string)=>void}} o
 */
export function createDropdown(name, { icon, title, prefix = '', alignRight = false, onPick }) {
  const wrap = $(`#${name}-dropdown-wrap`)
  wrap.classList.toggle('align-right', alignRight)
  wrap.innerHTML = `<button type="button" class="custom-select-btn" aria-haspopup="true" aria-expanded="false" title="${esc(title)}">
      ${icon}${prefix ? `<span class="dropdown-prefix">${esc(prefix)}</span>` : ''}<span class="dropdown-label"></span><span class="caret">${CARET}</span>
    </button>
    <div class="custom-dropdown-menu"></div>`
  const btn = wrap.querySelector('.custom-select-btn')
  const label = wrap.querySelector('.dropdown-label')
  const menu = wrap.querySelector('.custom-dropdown-menu')

  btn.addEventListener('click', () => {
    const open = !wrap.classList.contains('open')
    closeDropdowns(wrap)
    setOpen(wrap, open)
  })
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('.custom-dropdown-item')
    if (!item) return
    setOpen(wrap, false)
    onPick(item.dataset.id)
  })

  return {
    /** items: [{ id, label, hint?, tone? }] — 비어 있으면 메뉴 전체를 숨긴다. tone('ok' | 'danger')은 글자색. */
    render(items, selectedId) {
      wrap.hidden = !items.length
      if (!items.length) return setOpen(wrap, false)
      const current = items.find((i) => i.id === selectedId) || items[0]
      label.textContent = current.label
      btn.title = current.hint || title
      btn.dataset.tone = current.tone || ''
      menu.innerHTML = items
        .map(
          (i) =>
            `<button type="button" class="custom-dropdown-item${i === current ? ' selected' : ''}" data-id="${esc(i.id)}" data-tone="${i.tone || ''}"${i.hint ? ` title="${esc(i.hint)}"` : ''}><span>${esc(i.label)}</span>${CHECK_ICON}</button>`
        )
        .join('')
    }
  }
}
