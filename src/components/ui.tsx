import { useState, type ReactNode } from 'react';
export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
export function CopyCard({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setError('');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Select and copy the text manually.');
    }
  }
  return (
    <div className="copy-wrap">
      {label && <span className="field-caption">{label}</span>}
      <div className="copy-card">
        <code>{value}</code>
        <button
          type="button"
          className="copy-button"
          onClick={copy}
          aria-label={`Copy ${label || value}`}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {error && <small>{error}</small>}
    </div>
  );
}
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
export function ErrorText({ children }: { children: ReactNode }) {
  return children ? (
    <p className="error" role="alert">
      {children}
    </p>
  ) : null;
}
