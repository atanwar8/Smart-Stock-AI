'use client';

import { useState } from 'react';
import { useStoredState } from '@/lib/hooks';

// "Good evening, Chef" — click the name to make it yours. Kept on this device.
export default function ChefName() {
  const [name, setName] = useStoredState('smartstock.chef', 'Chef');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  if (editing) {
    const save = () => {
      setName(draft.trim().slice(0, 24) || 'Chef');
      setEditing(false);
    };
    return (
      <input
        autoFocus
        aria-label="Your name"
        value={draft}
        maxLength={24}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setEditing(false);
        }}
        className="inline-block min-w-[3ch] rounded-[10px] bg-well px-1 font-display text-[length:inherit] leading-[inherit] text-ink outline-none focus:ring-4 focus:ring-accent/15"
        style={{ width: `${Math.max(3, draft.length + 1)}ch` }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(name);
        setEditing(true);
      }}
      title="Change your name"
      aria-label={`${name}. Change your name`}
      className="rounded-[10px] decoration-line-2 decoration-dotted underline-offset-[6px] transition-colors hover:underline focus-visible:underline"
    >
      {name}
    </button>
  );
}
