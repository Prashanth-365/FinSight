import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils.js';
import { ChevronDown, Check } from 'lucide-react';

// A "free-typing" combobox: dropdown shows frequency-sorted suggestions,
// typing a brand-new value is allowed and is returned as-is.
// suggestions: string[] (already frequency-sorted ideally)
// value: string
// onChange: (str) => void
// rich: optional renderer (item) => JSX, used when items is an array of objects { value, label, hint }
export function Combobox({
  value = '',
  onChange,
  suggestions = [],
  placeholder = '',
  className,
  allowFreeText = true,
  emptyHint = 'Type to add a new value',
  renderItem,
  separator = null // when set (e.g. ','), filter & commit on the LAST token only
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value || '');
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef(null);

  useEffect(() => { setQuery(value || ''); }, [value]);

  // outside click
  useEffect(() => {
    function h(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, []);

  // In separator mode, suggestions match the text AFTER the last separator.
  const activeToken = useMemo(() => {
    if (!separator) return (query || '').trim();
    const parts = (query || '').split(separator);
    return (parts[parts.length - 1] || '').trim();
  }, [query, separator]);

  const filtered = useMemo(() => {
    const q = activeToken.toLowerCase();
    const items = suggestions.map((s) => (typeof s === 'string' ? { value: s, label: s } : s));
    if (!q) return items.slice(0, 50);
    return items.filter((i) => i.label.toLowerCase().includes(q)).slice(0, 50);
  }, [suggestions, activeToken]);

  const commit = (val) => {
    if (separator) {
      // Replace only the last token (preserving any space after the comma), then
      // leave a trailing separator so the next token can be typed or picked.
      const parts = (query || '').split(separator);
      const lead = parts[parts.length - 1].match(/^\s*/)[0];
      parts[parts.length - 1] = lead + val;
      const next = parts.join(separator) + separator + ' ';
      onChange?.(next);
      setQuery(next);
      setHighlight(0);
      setOpen(true);
      return;
    }
    onChange?.(val);
    setQuery(val);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <div className="relative">
        <input
          className="fs-input pr-9"
          placeholder={placeholder}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(0);
            if (allowFreeText) onChange?.(e.target.value);
          }}
          onKeyDown={(e) => {
            if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) setOpen(true);
            if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, filtered.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
            if (e.key === 'Enter') {
              e.preventDefault();
              const pick = filtered[highlight];
              if (pick) commit(pick.value);
              else if (allowFreeText) commit(query);
            }
            if (e.key === 'Escape') setOpen(false);
          }}
        />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="absolute inset-y-0 right-2 grid place-items-center text-muted-fg"
          tabIndex={-1}
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>

      {open && (
        <div className="absolute z-30 mt-1 w-full bg-surface border border-border rounded-xl shadow-card-dark max-h-72 overflow-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-fg">{emptyHint}</div>
          ) : (
            filtered.map((item, i) => (
              <button
                key={item.value + '-' + i}
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => commit(item.value)}
                className={cn(
                  'w-full text-left px-3 py-2 text-sm flex items-center gap-2',
                  i === highlight && 'bg-muted'
                )}
              >
                <span className="flex-1 truncate">{renderItem ? renderItem(item) : item.label}</span>
                {item.hint && <span className="text-xs text-muted-fg">{item.hint}</span>}
                {activeToken === item.value && <Check className="w-4 h-4 text-primary" />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
