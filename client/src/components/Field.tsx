import type { ReactNode } from 'react';

export function Field({
  label,
  required,
  error,
  hint,
  htmlFor,
  children,
  className
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`field${className ? ' ' + className : ''}`}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
        {required ? <span className="req">*</span> : null}
      </label>
      {children}
      {error ? <div className="field-error">{error}</div> : hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}
