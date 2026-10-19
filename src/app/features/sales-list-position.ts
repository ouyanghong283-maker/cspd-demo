import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';

/** View-only return context; never enters the business snapshot. */
@Injectable({ providedIn: 'root' })
export class SalesListPosition {
  private readonly router = inject(Router);
  private positions = new Map<string, number>();
  private key(): string {
    const url = new URL(this.router.url, window.location.origin);
    return (
      url.pathname +
      '?' +
      ['tab', 'department', 'q', 'status', 'owner', 'stage']
        .map((key) => `${key}=${url.searchParams.get(key) || ''}`)
        .join('&')
    );
  }
  remember(): void {
    this.positions.set(this.key(), window.scrollY);
  }
  restore(): void {
    const top = this.positions.get(this.key());
    if (top !== undefined) setTimeout(() => window.scrollTo(0, top), 0);
  }
}
