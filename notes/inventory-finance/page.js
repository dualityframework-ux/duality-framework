'use strict';
const controls = document.querySelector('#scenario-controls');
controls.hidden = false;
controls.addEventListener('change', event => {
  const values = InventoryFinance.values(event.target.value);
  for (const element of document.querySelectorAll('[data-value]')) {
    element.textContent = values[element.dataset.value];
  }
  document.querySelector('#announcement').textContent = `${values.label}. Proposed inventory reduction ${values.reduction}. Gross margin ${values.marginAfter}.`;
});
