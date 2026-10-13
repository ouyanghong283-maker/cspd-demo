import { ChangeDetectionStrategy, Component, input } from '@angular/core';
const paths: Record<string, string[]> = {
  dashboard: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
  sales: ['M3 7h18v14H3z', 'M8 7V3h8v4', 'M3 12h18', 'M10 12v3h4v-3'],
  project: ['M3 5h6l2 2h10v14H3z'],
  control: ['M4 7h16', 'M4 17h16', 'M8 4v6', 'M16 14v6'],
  arrow: ['M5 12h14', 'm14 7 5 5-5 5'],
  chevron: ['m9 5 7 7-7 7'],
  down: ['m6 9 6 6 6-6'],
  plus: ['M12 5v14', 'M5 12h14'],
  search: ['M21 21l-5-5', 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14'],
  bell: ['M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9', 'M10 21h4'],
  clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M12 7v5l3 2'],
  check: ['m5 12 4 4L19 6'],
  file: ['M5 3h9l5 5v13H5z', 'M14 3v6h5', 'M8 13h8', 'M8 17h6'],
  users: [
    'M8 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
    'M2 21v-3a6 6 0 0 1 12 0v3',
    'M16 4a4 4 0 0 1 0 8',
    'M18 15a5 5 0 0 1 4 5',
  ],
  trend: ['m3 17 6-6 4 4 8-10', 'M15 5h6v6'],
  grid: ['M4 4h16v16H4z', 'M4 10h16', 'M10 10v10'],
  upload: ['M12 16V3', 'm7 8 5-5 5 5', 'M4 15v6h16v-6'],
  download: ['M12 3v13', 'm7 11 5 5 5-5', 'M4 17v4h16v-4'],
  edit: ['m4 16-1 5 5-1L20 8l-5-5z', 'm13 5 6 6'],
  trash: ['M3 6h18', 'M8 6V3h8v3', 'M5 6l1 15h12l1-15', 'M10 10v7', 'M14 10v7'],
  close: ['m6 6 12 12', 'M18 6 6 18'],
  info: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M12 11v6', 'M12 7v1'],
  lock: ['M5 10h14v11H5z', 'M8 10V7a4 4 0 0 1 8 0v3'],
  play: ['m8 4 12 8-12 8z'],
  reset: ['M3 11a9 9 0 1 1 2 7', 'M3 3v8h8'],
  menu: ['M3 6h18', 'M3 12h18', 'M3 18h18'],
  building: [
    'M4 21V5l8-2v18',
    'M12 9h8v12',
    'M7 7v1',
    'M7 12v1',
    'M7 17v1',
    'M15 13h2',
    'M15 17h2',
  ],
  globe: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M3 12h18', 'M12 3c5 6 5 12 0 18-5-6-5-12 0-18'],
  logout: ['M9 4H4v16h5', 'M9 12h12', 'm16 7 5 5-5 5'],
  calendar: ['M4 5h16v16H4z', 'M8 3v4', 'M16 3v4', 'M4 10h16'],
  link: ['m9 15 6-6', 'M7 14l-3 3a3 3 0 0 0 4 4l3-3', 'M13 6l3-3a3 3 0 0 1 4 4l-3 3'],
};
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.65"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    @for (path of iconPaths(); track $index) {
      <path [attr.d]="path" />
    }
  </svg>`,
  styles: `
    :host {
      display: inline-flex;
      width: 20px;
      height: 20px;
      flex-shrink: 0;
      vertical-align: middle;
    }
    svg {
      width: 100%;
      height: 100%;
    }
  `,
})
export class Icon {
  name = input('dashboard');
  iconPaths = () => paths[this.name()] || paths['file'];
}
