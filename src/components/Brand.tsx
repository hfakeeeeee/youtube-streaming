import { Radio } from 'lucide-react';

export function Brand() {
  return (
    <a className="brand" href="#/" aria-label="Syncbox home">
      <span className="brand-mark"><Radio size={19} strokeWidth={2.4} /></span>
      <span>sync<span>box</span></span>
    </a>
  );
}
