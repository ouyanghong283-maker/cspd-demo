import { Component } from '@angular/core';
import { V10BaselinePanel } from '../../shared/v10-baseline-panel';
@Component({
  imports: [V10BaselinePanel],
  template: '<app-v10-baseline-panel page="exceptions" />',
})
export class V10ExceptionsPage {}
