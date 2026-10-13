import { Injectable, signal } from '@angular/core';
import { DialogRequest } from './models';
@Injectable({ providedIn: 'root' })
export class UiService {
  readonly dialog = signal<DialogRequest | null>(null);
  readonly toast = signal<{ text: string; error: boolean } | null>(null);
  private timer?: ReturnType<typeof setTimeout>;
  open(request: DialogRequest): void {
    this.dialog.set(request);
  }
  notify(text: string, error = false): void {
    clearTimeout(this.timer);
    this.toast.set({ text, error });
    this.timer = setTimeout(() => this.toast.set(null), 6000);
  }
  fail(text: string): false {
    this.notify(text, true);
    return false;
  }
}
