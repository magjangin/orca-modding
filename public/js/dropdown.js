// 입력창 아래 줄의 펼침 메뉴(모델·권한·핑퐁). 마크업은 index.html의 .custom-dropdown-wrap.
import { $, esc } from './core.js'

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

// items: [{ id, label, hint?, tone? }] — tone('ok' | 'danger')은 버튼·항목 글자색을 바꾼다.
export function createDropdown(name, onPick) {
  const wrap = $(`#${name}-dropdown-wrap`)
  const btn = wrap.querySelector('.custom-select-btn')
  const label = wrap.querySelector('.dropdown-label')
  const menu = wrap.querySelector('.custom-dropdown-menu')
  const baseTitle = btn.title

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
    render(items, selectedId) {
      const current = items.find((i) => i.id === selectedId) || items[0]
      label.textContent = current.label
      btn.title = current.hint || baseTitle
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
