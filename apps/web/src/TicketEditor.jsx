import { useIndiaDay } from '../../../shared/use-india-day.js';
import React, { useState } from 'react';

export function TicketEditor({ basket, menu, orderNote, onSave, onCancel }) {
  const [lines, setLines] = useState(basket);
  const [note, setNote] = useState(orderNote || '');
  const day = useIndiaDay();
  const available = menu.filter(item => item.soldOutDay !== day && !lines.some(line => line.item === item.id));
  function change(id, values) {
    setLines(lines.map(line => line.item === id ? { ...line, ...values } : line));
  }
  return <form className="ticket-editor" onSubmit={event => {
    event.preventDefault();
    onSave(lines.map(line => ({ ...line, quantity: Number(line.quantity) })), note.trim());
  }}>
    {lines.map(line => {
      const item = menu.find(row => row.id === line.item);
      const name = [item?.name, item?.variant].filter(Boolean).join(' ');
      return <fieldset key={line.item}>
        <legend>{name}</legend>
        <label>Quantity<input type="number" min="0.25" max="99" step="0.25" required
          aria-label={'Quantity for ' + name} value={line.quantity}
          onChange={e => change(line.item, { quantity: e.target.value })} /></label>
        <label>Dish instructions<input maxLength={400} value={line.note || ''}
          onChange={e => change(line.item, { note: e.target.value })} /></label>
        <button type="button" className="plain" aria-label={'Remove ' + name}
          onClick={() => setLines(lines.filter(row => row.item !== line.item))}>Remove</button>
      </fieldset>;
    })}
    {available.length > 0 && lines.length < 60 && <label>Add dish
      <select value="" onChange={e => setLines([...lines, { item: e.target.value, quantity: 1 }])}>
        <option value="" disabled>Choose from menu</option>
        {available.map(item => <option key={item.id} value={item.id}>{item.name} {item.variant}</option>)}
      </select>
    </label>}
    <label>Kitchen note<input maxLength={600} value={note} onChange={e => setNote(e.target.value)} /></label>
    <footer><button className="action">Apply changes</button>
      <button type="button" className="plain" onClick={onCancel}>Cancel</button></footer>
  </form>;
}
