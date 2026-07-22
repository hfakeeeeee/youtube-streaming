import { AudioWaveform } from 'lucide-react';

export function Brand() {
  return (
    <a className="brand" href="#/" aria-label="Syncbox home">
      <span className="brand-mark"><AudioWaveform size={20} strokeWidth={2.3} /></span>
      <span>sync<span>box</span></span>
    </a>
  );
}
