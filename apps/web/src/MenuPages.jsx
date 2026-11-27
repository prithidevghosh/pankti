import React, { useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { asRupees } from './api.js';
import './menu-pages.css';

export const editableDish = (item) => ({
  ...item,
  key: item.id || crypto.randomUUID(),
  rupees: item.price == null ? '' : String(item.price / 100),
});
export const menuEntry = ({ name, variant, category, rupees }) => ({
  name: name.trim(),
  variant: variant.trim(),
  category: category.trim(),
  price: Math.round(Number(rupees) * 100),
});
export const needsPrice = (row) => !(Number(row.rupees) > 0);

function DishEditor({ row, busy, draft, onSave, onClose, onRemove }) {
  const [fields, setFields] = useState(row);
  return (
    <form
      className="dish-editor"
      onSubmit={async (event) => {
        event.preventDefault();
        await onSave(fields);
      }}
    >
      <fieldset disabled={busy}>
        <legend>Edit dish</legend>
        <div className="dish-inputs">
          {[
            ['name', 'Dish name', 96],
            ['rupees', 'Price (₹)'],
            ['variant', 'Portion', 64],
            ['category', 'Category', 96],
          ].map(([key, label, max]) => (
            <label key={key}>
              {label}
              <input
                autoFocus={key === (needsPrice(row) ? 'rupees' : 'name')}
                value={fields[key]}
                required={key !== 'variant'}
                maxLength={max}
                type={key === 'rupees' ? 'number' : 'text'}
                min={key === 'rupees' ? '.01' : undefined}
                max={key === 'rupees' ? '100000' : undefined}
                step={key === 'rupees' ? '.01' : undefined}
                pattern={key === 'name' || key === 'category' ? '.*\\S.*' : undefined}
                onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
              />
            </label>
          ))}
        </div>
        <div className="dish-controls">
          <button type="submit">{draft ? 'Apply changes' : 'Save changes'}</button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          {draft && (
            <button type="button" onClick={onRemove}>
              Omit dish
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}

export function MenuPages({ rows, draft = false, active, setActive, busy, onSave, onRemove }) {
  const groups = new Map();
  const triggers = useRef(new Map());
  for (const row of rows) {
    if (!groups.has(row.category)) groups.set(row.category, []);
    groups.get(row.category).push(row);
  }
  function close(key) {
    setActive(null);
    requestAnimationFrame(() => triggers.current.get(key)?.focus());
  }
  return (
    <div className="menu-pages">
      {[...groups].map(([category, dishes]) => (
        <section className="menu-chapter" key={category}>
          <h3>{category}</h3>
          <ul>
            {dishes.map((item) => {
              const key = item.key || item.id;
              const expanded = active === key;
              return (
                <li key={key}>
                  <button
                    className={'dish-line' + (item.duplicate ? ' dish-skipped' : '')}
                    type="button"
                    aria-label={'Edit ' + item.name + (item.variant ? ' ' + item.variant : '')}
                    aria-expanded={expanded}
                    disabled={!!item.duplicate || busy || (!!active && !expanded)}
                    ref={(node) => {
                      if (node) triggers.current.set(key, node);
                      else triggers.current.delete(key);
                    }}
                    onClick={() => (expanded ? close(key) : setActive(key))}
                  >
                    <span className="dish-name">
                      {item.name}
                      {item.variant && <small>{item.variant}</small>}
                      {item.duplicate && <small className="dish-note">{item.duplicate}</small>}
                      {item.conflict && <small className="dish-note">Check details</small>}
                    </span>
                    <span className="dish-leader" aria-hidden="true" />
                    <span className={draft && needsPrice(item) ? 'missing-price' : 'dish-price'}>
                      {draft && needsPrice(item)
                        ? 'Add price'
                        : asRupees(draft ? menuEntry(item).price : item.price).replace(/\.00$/, '')}
                    </span>
                    {!item.duplicate && <Pencil size={14} aria-hidden="true" />}
                  </button>
                  {expanded && (
                    <DishEditor
                      row={draft ? item : editableDish(item)}
                      draft={draft}
                      busy={busy}
                      onClose={() => close(key)}
                      onRemove={() => {
                        onRemove(key);
                        setActive(null);
                      }}
                      onSave={async (fields) => {
                        if (await onSave(fields)) close(key);
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
