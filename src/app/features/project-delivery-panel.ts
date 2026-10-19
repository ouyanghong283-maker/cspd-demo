import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { DemoStore } from '../core/store';
import { provided } from '../core/delivery-overview';
import type { Project } from '../core/models';
type DeliveryProject = Omit<Project, 'sat' | 'handover'> &
  Partial<Pick<Project, 'sat' | 'handover'>>;
import { Documents } from '../shared/documents';

@Component({
  selector: 'app-project-delivery-panel',
  imports: [RouterLink, Documents],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-delivery-panel.html',
  styleUrl: './project-delivery-panel.scss',
})
export class ProjectDeliveryPanel {
  readonly projectId = input.required<string>();
  readonly store = inject(DemoStore);
  readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  readonly project = computed<DeliveryProject | undefined>(() =>
    this.store.project(this.projectId()),
  );
  readonly contract = computed(() =>
    this.store.state().contracts.find((c) => c.id === this.project()?.contractId),
  );
  readonly tab = computed(() =>
    (this.params().get('deliveryTab') || this.params().get('tab')) === 'service'
      ? 'service'
      : 'logistics',
  );
  readonly logisticsPlans = computed(() =>
    (this.project()?.plans || []).filter((p) => !['内部WBS', '客户主节点'].includes(p.type)),
  );
  readonly sparePlans = computed(() =>
    (this.project()?.plans || []).filter((p) => p.type === '调试备件'),
  );
  readonly history = computed(() => this.store.operationEvents(this.projectId()));
  readonly value = provided;
  selectTab(tab: string): void {
    const inProject = this.router.url.startsWith('/projects/');
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: inProject ? { deliveryTab: tab } : { tab },
      queryParamsHandling: 'merge',
      preserveFragment: true,
    });
  }
  actionParams(tab: string, section: string | null = null): Record<string, string | null> {
    const inProject = this.router.url.startsWith('/projects/');
    return {
      tab,
      section,
      projectId: this.projectId(),
      returnTo: inProject ? this.params().get('returnTo') : this.router.url,
      returnLabel: inProject ? this.params().get('returnLabel') : '返回交付与售后',
      deliveryTab: this.tab(),
    };
  }
}
