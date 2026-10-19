import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { useV10ViewNavigation } from '../core/management-v10-platform/view-navigation';
@Component({
  selector: 'app-v10-return',
  imports: [RouterLink],
  template: `@if (navigation.returnTarget(); as href) {
      <a class="text-link" [routerLink]="href" data-v10-focus="return">返回上一层</a>
    }
    @for (notice of navigation.notices(); track notice) {
      <p role="status">{{ notice }}</p>
    }
    @if (navigation.error(); as error) {
      <p role="status">{{ error }}</p>
    }`,
})
export class V10Return {
  readonly navigation = useV10ViewNavigation(true);
}
