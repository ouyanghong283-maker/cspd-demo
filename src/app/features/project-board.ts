import { V10BaselinePanel } from '../shared/v10-baseline-panel';
import { selectSolutionWorkspace } from '../core/v9-queries';
import { formatSolutionTime } from '../core/solution-workflow/presentation';
import { SolutionClock } from '../core/solution-workflow/clock';
import { ManagementBoardChartsComponent } from './management-board-charts';
import { SolutionFilesService, checkSolutionFile } from '../core/solution-workflow/files';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  OnDestroy,
  afterNextRender,
  effect,
  untracked,
} from '@angular/core';
import { Router, RouterLink, UrlTree } from '@angular/router';
import { DemoStore } from '../core/store';
import { collectDemoProjectWorkItems } from '../core/work-item-sources';
import type { WorkItem } from '../core/work-item-registry';
import { selectManagementBoard } from '../core/management-board';
import { selectManagementStatistics, selectCompleteWorkItems } from '../core/management-statistics';
import { formatBudgetAmount } from '../core/budget';
import { readBoardView, saveBoardView } from '../core/management-board/view-state';
import type {
  ManagementBoardFilters,
  BudgetCurrency,
  CompleteWorkItemView,
  FirstFinalization,
  FileAvailability,
} from '../core/v9-contracts';
import { Badge } from '../shared/badge';

function defaultBoardFilters(): ManagementBoardFilters {
  return {
    projectIds: [],
    businessIds: [],
    grades: [],
    departments: [],
    firstResults: [],
    query: '',
    partition: 'all',
    regions: [],
    stages: [],
    owners: [],
    budgetCurrency: 'CNY',
  };
}

@Component({
  selector: 'app-project-board',
  imports: [RouterLink, Badge, ManagementBoardChartsComponent, V10BaselinePanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="board-page" [class.reduce-motion]="reducedMotion()">
      <section
        class="management-overview v9-reading"
        data-v9-theme="dark"
        aria-label="高层项目总览"
      >
        <div class="v9-toolbar">
          <h1>高层项目总览</h1>
          <span>本地已保存业务 · 本次查看 {{ refreshedAt() }}</span>
          <button
            type="button"
            class="v9-button"
            aria-label="减弱看板动效"
            [attr.aria-pressed]="reducedMotion()"
            (click)="toggleMotion()"
          >
            减弱动效：{{ reducedMotion() ? '已开启' : '跟随系统' }}
          </button>
        </div>
        <p class="board-intro">同商机多项目只计一条主线；进度取最慢子项目。</p>
        <details class="board-source-context">
          <summary>
            日期与来源：方案 {{ dates().solutionBusinessDate }} · 计划观察
            {{ dates().planObservationDate }} · 预算 {{ currency() }}
          </summary>
          <p>
            方案使用上海自然日；计划使用当前观察档；预算范围与截止日见费用明细，实际支出为模拟数据。
          </p>
          <p>文件核验只影响当前可用性，不抹除历史上传或首次定稿成绩。</p>
          <button type="button" class="v9-button" (click)="refreshFiles()">重新核验本地文件</button>
        </details>
        <div class="v9-summary" aria-label="业务主线统计">
          <span
            ><strong>{{ management().businessCount }}</strong
            >条业务主线</span
          >
          <span
            ><strong>{{ management().projectCount }}</strong
            >个已核执行项目</span
          >
          <span
            ><strong>{{ management().pendingReviewCount }}</strong
            >项关联待核</span
          >
        </div>
        @if (viewError()) {
          <p class="v9-notice" role="alert">{{ viewError() }}</p>
        }
        <form class="board-filters" aria-label="总览筛选" (submit)="$event.preventDefault()">
          <label
            >分区<select
              #partition
              [value]="filters().partition || 'all'"
              (change)="change('partition', partition.value)"
            >
              <option value="all">全部</option>
              <option value="presales">售前</option>
              <option value="execution">执行</option>
            </select></label
          >
          <label
            >等级<select
              #grade
              [value]="filters().grades[0] || ''"
              (change)="change('grades', grade.value)"
            >
              <option value="">全部</option>
              @for (g of ['S', 'A', 'B1', 'B2']; track g) {
                <option [value]="g">{{ g }}</option>
              }
            </select></label
          >

          <label
            >关键字<input
              #search
              [value]="filters().query"
              (input)="change('query', search.value)"
              placeholder="商机编号或项目名称"
          /></label>
          <label
            ><input
              type="checkbox"
              #exceptionOnly
              [checked]="filters().exceptionOnly || false"
              (change)="filters.update(toggleExceptions); persistView()"
            />仅异常业务</label
          >
          <details
            class="advanced-filters"
            [open]="advancedOpen()"
            (toggle)="toggleAdvanced($event)"
          >
            <summary>更多筛选（区域、阶段、部门、负责人、币种）</summary>
            <div class="advanced-fields">
              <label
                >区域<select
                  #region
                  [value]="filters().regions?.[0] || ''"
                  (change)="change('regions', region.value)"
                >
                  <option value="">全部</option>
                  @for (r of options().regions; track r) {
                    <option [value]="r">{{ r }}</option>
                  }
                </select></label
              >
              <label
                >阶段<select
                  #stage
                  [value]="filters().stages?.[0] || ''"
                  (change)="change('stages', stage.value)"
                >
                  <option value="">全部</option>
                  @for (st of options().stages; track st) {
                    <option [value]="st">{{ st }}</option>
                  }
                </select></label
              >
              <label
                >部门<select
                  #dept
                  [value]="filters().departments[0] || ''"
                  (change)="change('departments', dept.value)"
                >
                  <option value="">全部</option>
                  @for (d of ['sales', 'solution', 'pm-pmo', 'service', 'unknown']; track d) {
                    <option [value]="d">{{ departmentLabels[d] }}</option>
                  }
                </select></label
              >
              <label
                >负责人<select
                  #owner
                  [value]="filters().owners?.[0] || ''"
                  (change)="change('owners', owner.value)"
                >
                  <option value="">全部</option>
                  @for (o of options().owners; track o) {
                    <option [value]="o">{{ o }}</option>
                  }
                </select></label
              >
              <label
                >预算币种<select
                  #currencySelect
                  [value]="currency()"
                  (change)="change('budgetCurrency', currencySelect.value)"
                >
                  <option>CNY</option>
                  <option>EUR</option>
                  <option>USD</option>
                </select></label
              >
            </div>
          </details>
          <button type="button" class="v9-button" (click)="clearFilters()">清除全部筛选</button>
        </form>
        <div class="filter-context" aria-label="已选筛选条件">
          <p role="status">
            当前范围：{{ management().businessCount }} 条主线 /
            {{ management().projectCount }} 个项目 · 预算 {{ currency() }}
          </p>
          @for (chip of filterChips(); track chip.id) {
            <button
              type="button"
              class="v9-button filter-chip"
              [attr.data-filter-key]="chip.key"
              [attr.aria-label]="'清除' + chip.label"
              (click)="removeFilter(chip.key, chip.value)"
            >
              {{ chip.label }} ×
            </button>
          }
        </div>
        @if (!store.state().sales.length && !store.state().projects.length) {
          <p class="v9-empty">尚无业务记录，请先建立商机。</p>
        } @else if (!management().businessCount) {
          <p class="v9-empty">当前组合筛选无匹配业务，可清除筛选。</p>
        }
        <div class="priority-grid">
          <section class="v9-panel" aria-label="重点TOP5">
            <h2>重点 TOP5</h2>
            <details class="board-explanation">
              <summary>查看排序与日期口径</summary>
              <p>
                等级 S → A → B1 →
                B2；同级先功率组、再能量组，组内容量降序，最后稳定编号。缺值置后。计划日期只取客户节点或商机粗计划。
              </p>
            </details>
            @if (priorityTimeline().start) {
              <p>共同日期轴：{{ priorityTimeline().start }} 至 {{ priorityTimeline().end }}</p>
            }
            @for (item of priorityTimeline().items; track item.businessId) {
              <article class="priority-item">
                <a
                  [routerLink]="target(item.sourceHref)"
                  [attr.data-board-focus]="'top:' + item.businessId"
                  (click)="leave()"
                  >{{ store.sale(item.businessId)?.projectName || item.businessId }}</a
                >
                <p>
                  {{ item.businessId }} · {{ item.grade || '等级待补' }} ·
                  {{ item.capacity ?? '容量待补' }} {{ item.capacityUnit || '' }}
                </p>
                <p>
                  负责人 {{ item.ownerName || '待补' }} · 进度
                  {{ progressText(item.progressLabel || '待补') }}
                </p>
                <p>{{ item.timelineLabel }}</p>
                @if (item.startDate && item.deadlineDate) {
                  <div
                    class="time-bar"
                    role="img"
                    [attr.aria-label]="
                      '计划开始' + item.startDate + '，计划截止' + item.deadlineDate
                    "
                  >
                    <span
                      [style.width.%]="item.widthPercent"
                      [style.margin-left.%]="item.leftPercent"
                    ></span>
                  </div>
                  <p>计划 {{ item.startDate }} 至 {{ item.deadlineDate }}</p>
                } @else {
                  <p class="v9-status">
                    日期待补 · 截止 {{ item.deadlineDate || '待补' }}；不绘制时间条
                  </p>
                }
              </article>
            } @empty {
              <p class="v9-empty">当前范围没有重点业务。</p>
            }
          </section>
          <section class="v9-panel" aria-label="可行动异常">
            <h2>可行动异常</h2>
            <p class="exception-summary" aria-label="异常分类汇总">
              @for (group of exceptionSummary(); track group.id) {
                <span
                  >{{ group.label }} <strong>{{ group.count }}</strong></span
                >
              }
            </p>
            <details class="board-explanation">
              <summary>查看异常口径</summary>
              <p>
                按延期、方案逾期、超预算、待补顺序排列；数量按事项计，同一业务可有多项。历史逾期完成不计当前延期；待补不代表业务失败。
              </p>
            </details>
            <div class="exception-list">
              @for (item of actionableExceptions(); track item.id) {
                <article class="priority-item">
                  <a
                    [routerLink]="target(item.sourceHref)"
                    [attr.data-board-focus]="'exception:' + item.id"
                    (click)="leave()"
                    >{{ item.reason }}</a
                  >
                  <p>
                    {{ item.projectId || item.businessId }} ·
                    {{ item.owner?.name || '负责人待补' }} · {{ item.date || '日期待补' }}
                    @if (item.daysOverdue) {
                      · 逾期 {{ item.daysOverdue }} 天
                    }
                  </p>
                  <small>来源：{{ item.sourceLabel || '稳定关联核查' }}</small>
                </article>
              } @empty {
                <p class="v9-empty">
                  {{
                    management().businessCount
                      ? '当前已核实范围没有未解决异常。'
                      : '当前范围无可核实业务，不判断异常数。'
                  }}
                </p>
              }
            </div>
          </section>
        </div>
        <app-management-board-charts
          [summary]="statistics()"
          [stages]="stageData()"
          [selectedStages]="filters().stages || []"
          [budgets]="chartBudgets()"
          [currency]="currency()"
          [projectCount]="management().projectCount"
          (sourceOpen)="openSource($event)"
          (stageChange)="selectStage($event)"
          (departmentChange)="selectDepartment($event)"
          [selectedResult]="firstResult()"
          (firstResultChange)="selectFirst($event)"
        />
        <nav class="v9-toolbar" aria-label="清单分区">
          @for (part of partitions; track part.id) {
            <button
              class="v9-button"
              (click)="goSection(part.id)"
              [attr.aria-pressed]="section() === part.id"
            >
              {{ part.label }}清单
            </button>
          }
        </nav>
        @for (partition of partitions; track partition.id) {
          <h2 [id]="'board-' + partition.id">
            {{ partition.label }} · {{ partitionCount(partition.id) }} 条主线
          </h2>
          <div
            class="v9-table-wrap"
            role="region"
            [attr.aria-label]="partition.label + '业务清单，可横向滚动'"
            tabindex="0"
          >
            <table class="v9-table">
              <thead>
                <tr>
                  <th>业务主线</th>
                  <th>执行项目</th>
                  <th>最慢进度</th>
                  <th>来源</th>
                </tr>
              </thead>
              <tbody>
                @for (business of management().businesses; track business.businessId) {
                  @if (business.partition === partition.id) {
                    <tr [attr.data-business-id]="business.businessId">
                      <td>
                        {{ store.sale(business.opportunityId)?.projectName || business.businessId
                        }}<br /><small>{{ business.businessId }}</small>
                        @if (solutionSummaries().get(business.businessId); as solution) {
                          <details class="solution-summary">
                            <summary>方案期限、首次与当前资料</summary>
                            <p>
                              PM {{ solution.workspace?.schedule?.pm?.name || '待补' }} · 负责人
                              {{ solution.workspace?.schedule?.owner?.name || '待补' }}
                            </p>
                            <p>
                              期限 {{ solution.workspace?.schedule?.deadlineDate || '待补' }} · 调整
                              {{ solution.workspace?.scheduleChanges?.length || 0 }} 次
                            </p>
                            <p>
                              首次 {{ firstLabels[solution.firstResult] }} ·
                              {{ businessTime(solution.firstConfirmedAt) }}
                            </p>
                            <p>
                              当前 {{ currentLabels[solution.currentStatus] }} ·
                              {{
                                businessTime(solution.workspace?.finalizations?.at(-1)?.confirmedAt)
                              }}
                            </p>
                            @for (file of solution.files; track file.kind) {
                              <p>
                                {{ fileKindLabels[file.kind] }} ·
                                {{ file.version?.fileName || '资料待补' }} ·
                                {{ fileLabels[file.availability] }}
                              </p>
                            }
                          </details>
                        }
                      </td>
                      <td>
                        {{ business.projectIds.length }} 个<br />{{
                          business.slowestProjectId || '尚未建项'
                        }}
                      </td>
                      <td>
                        {{ progressText(business.progress.displayPercent) }}
                        @if (business.incomplete) {
                          <span class="v9-status"> · 来源待补</span>
                        }
                      </td>
                      <td>
                        <nav aria-label="业务下钻">
                          <a
                            [routerLink]="target(business.sourceHref)"
                            [attr.data-board-focus]="'source:' + business.businessId"
                            (click)="leave()"
                            >查看来源</a
                          >
                          ·
                          <a
                            [routerLink]="target(source(business.businessId, 'quote'))"
                            [attr.data-board-focus]="'quote:' + business.businessId"
                            (click)="leave()"
                            >报价</a
                          >
                          ·
                          <a
                            [routerLink]="target(source(business.businessId, 'solution'))"
                            [attr.data-board-focus]="'solution:' + business.businessId"
                            (click)="leave()"
                            >方案</a
                          >
                          @if (business.projectIds.length) {
                            ·
                            <a
                              [routerLink]="target(source(business.businessId, 'plan'))"
                              [attr.data-board-focus]="'plan:' + business.businessId"
                              (click)="leave()"
                              >计划</a
                            >
                            ·
                            <a
                              [routerLink]="target(source(business.businessId, 'acceptance'))"
                              [attr.data-board-focus]="'acceptance:' + business.businessId"
                              (click)="leave()"
                              >验收</a
                            >
                          }
                        </nav>
                      </td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>
          @if (!hasPartition(partition.id)) {
            <p class="v9-empty">当前范围没有{{ partition.label }}主线。</p>
          }
        }
        @if (management().pendingReviewCount) {
          <h2>关联待核</h2>
          <p>以下记录保留原始身份，不按相同名称合并，未计入可靠主线汇总。</p>
          @for (item of management().exceptions; track $index) {
            @if (!item.category) {
              <p>
                <a [routerLink]="target(item.sourceHref)" (click)="leave()">{{
                  item.projectId || item.businessId
                }}</a
                >：{{ item.reason }}
              </p>
            }
          }
        }
      </section>
      <details
        class="collaboration-details"
        [open]="collaborationOpen()"
        (toggle)="toggleCollaboration($event)"
      >
        <summary>
          项目协作明细 · 当前范围 {{ groups().length }} 个项目 / {{ collaborationCount() }} 项待处理
        </summary>
        <header class="page-heading">
          <div>
            <p class="eyebrow">项目协作 · 共用视图</p>
            <h2>项目协作明细</h2>
            <p class="intro">
              项目计划、启动移交和已关联项目的部门任务来自已保存业务记录；责任人和项目关系保持不变。
            </p>
          </div>
          <a class="all-projects" routerLink="/projects">查看全部项目</a>
        </header>

        <section class="board-summary" aria-label="看板待办计数">
          <div>
            <strong>{{ collaborationCount() }}</strong
            ><span>项待处理</span>
          </div>
          <div>
            <strong>{{ groups().length }}</strong
            ><span>个项目</span>
          </div>
        </section>

        @for (group of groups(); track group.project.id) {
          <section class="project-group" [attr.data-project-id]="group.project.id">
            <header class="project-heading">
              <span class="project-node" aria-hidden="true"></span>
              <div class="project-title">
                <span class="project-id">{{ group.project.id }}</span>
                <h2>{{ group.project.name }}</h2>
                <p>
                  {{ store.customer(group.project.customerId)?.name || '客户待核' }} · PM
                  {{ group.project.pm || '待分配' }} · {{ group.project.status }}
                </p>
              </div>
              <div class="project-side">
                <span class="project-count">{{ group.items.length }} 项</span>
                <a
                  [routerLink]="target('/projects/' + group.project.id)"
                  [attr.data-board-focus]="'project:' + group.project.id"
                  (click)="leave()"
                  >打开项目</a
                >
              </div>
            </header>
            <div class="group-items">
              @for (item of group.items; track item.id) {
                <a
                  class="work-item"
                  [attr.data-board-focus]="'work:' + item.id"
                  [class.completed]="item.status === 'completed'"
                  [attr.data-work-item-id]="item.id"
                  [routerLink]="workItemTarget(item)"
                  (click)="leave()"
                >
                  <span class="item-mark" aria-hidden="true"></span>
                  <span class="item-content">
                    <strong>{{ item.title }}</strong>
                    <small>{{ item.id }}</small>
                  </span>
                  <span class="item-owner">{{ item.owner }}</span>
                  <time class="item-due">{{ item.dueDate || '' }}</time>
                  <span class="item-badge">
                    @if (item.warning; as warning) {
                      <app-badge [text]="warning.label" [risk]="warning.level" />
                    }
                  </span>
                  <span class="item-status" [class.done]="item.status === 'completed'">
                    {{ item.status === 'completed' ? '已完成' : '待处理' }}
                  </span>
                </a>
              } @empty {
                <p class="empty-project">当前项目没有未完成的计划、待移交事项或关联部门任务。</p>
              }
            </div>
          </section>
        } @empty {
          <section class="empty-board" aria-live="polite">
            <h2>还没有可展示的项目记录</h2>
            <p>创建或接收项目并登记计划后，项目节点会自动出现在这里。</p>
            <a routerLink="/projects">前往项目工作</a>
          </section>
        }
        <p class="board-footnote">
          本地看板展示已登记的项目计划、启动交接和可关联项目的部门任务；通知已读状态不会改变任务状态。财务摘要请查看首页的来源状态。
        </p>
      </details>
    </main>
    <app-v10-baseline-panel page="board" />
  `,
  styleUrl: './project-board.scss',
  styles: `
    :host {
      display: block;
      color: var(--ink, #18243b);
    }
    .board-page {
      max-width: 1600px;
      margin: 0 auto;
      padding: 28px 26px 56px;
    }

    .board-filters .advanced-filters {
      flex: 1 1 100%;
      min-width: 0;
    }
    .advanced-fields {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      padding-block: 12px;
    }
    .advanced-fields label {
      flex: 1 1 145px;
    }
    summary {
      cursor: pointer;
      line-height: 1.7;
    }
    summary:focus-visible {
      outline: 2px solid var(--v9-accent, #234fb0);
      outline-offset: 3px;
    }
    .filter-context {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      padding-top: 12px;
    }
    .filter-context p {
      margin: 0;
      flex-basis: 100%;
    }
    .filter-chip {
      font-size: 12px;
    }
    .exception-summary {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 16px;
    }
    .exception-summary strong {
      font-variant-numeric: tabular-nums;
      color: var(--v9-ink);
    }
    .board-explanation {
      font-size: 12px;
      color: var(--v9-muted);
    }
    .collaboration-details {
      border: 1px solid #c7d2df;
      border-radius: 8px;
      padding: 16px;
      background: #fff;
      color: #183047;
    }
    .collaboration-details > summary {
      font-weight: 600;
    }
    .collaboration-details .page-heading {
      margin-top: 20px;
    }
    .board-filters > label:has(input[type='checkbox']) {
      flex: 0 1 auto;
      display: flex;
      align-items: center;
    }
    @media (max-width: 700px) {
      .board-intro {
        font-size: 12px;
      }
      .board-filters {
        gap: 8px;
      }
      .board-filters label {
        flex-basis: 120px;
      }
      .management-overview .v9-summary {
        gap: 8px;
      }
      .management-overview .v9-toolbar {
        gap: 8px;
      }
    }
    /* 一级：页面标题 */
    .page-heading {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 24px;
      padding-bottom: 20px;
      margin-bottom: 18px;
      border-bottom: 1px solid var(--line, #e7ebf1);
    }
    .eyebrow {
      margin: 0 0 8px;
      color: var(--primary, #315dde);
      font-size: 12px;
      font-weight: 650;
      letter-spacing: 0.09em;
    }
    h1 {
      margin: 0;
      font-size: 26px;
      font-weight: 650;
      letter-spacing: -0.5px;
    }
    .intro {
      margin: 8px 0 0;
      max-width: 58ch;
      color: var(--muted, #7a8598);
      font-size: 13px;
      line-height: 1.7;
    }
    .all-projects,
    .empty-board a {
      padding: 9px 14px;
      border: 1px solid #dfe5ef;
      border-radius: 7px;
      color: #425069;
      background: #fff;
      font-size: 13px;
      font-weight: 550;
      white-space: nowrap;
      transition:
        background var(--board-transition, 0.15s),
        border-color var(--board-transition, 0.15s);
    }
    .all-projects:hover,
    .empty-board a:hover {
      background: #f3f6fb;
      border-color: #bac8df;
      color: var(--primary, #315dde);
    }

    /* 概览计数 */
    .board-summary {
      display: flex;
      gap: 12px;
      margin-bottom: 24px;
    }
    .board-summary > div {
      display: flex;
      align-items: baseline;
      gap: 8px;
      padding: 13px 18px;
      background: var(--surface, #fff);
      border: 1px solid var(--line, #e7ebf1);
      border-radius: var(--radius, 10px);
    }
    .board-summary strong {
      color: var(--primary, #315dde);
      font-size: 22px;
      font-weight: 650;
      letter-spacing: -0.4px;
      line-height: 1.2;
    }
    .board-summary span {
      color: var(--muted, #7a8598);
      font-size: 12px;
    }

    /* 二级：项目组 */
    .project-group {
      position: relative;
      margin-bottom: 20px;
      overflow: hidden;
      background: var(--surface, #fff);
      border: 1px solid var(--line, #e7ebf1);
      border-radius: var(--radius, 10px);
    }
    /* 贯穿项目节点与任务圆点的纵向轨道，表达上下级从属关系 */
    .project-group::before {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      left: 29px;
      width: 1px;
      background: #dfe5ee;
    }
    .project-heading {
      display: flex;
      align-items: center;
      gap: 15px;
      padding: 17px 22px;
      background: #fbfcfe;
      border-bottom: 1px solid var(--line, #e7ebf1);
    }
    .project-node {
      width: 13px;
      height: 13px;
      flex: 0 0 auto;
      border: 3px solid #c7d4f2;
      border-radius: 50%;
      background: var(--surface, #fff);
      z-index: 1;
    }
    .project-title {
      min-width: 0;
      flex: 1;
    }
    .project-id {
      color: #4e6077;
      font-size: 11px;
      letter-spacing: 0.05em;
    }
    .project-heading h2 {
      margin: 2px 0 0;
      color: #22304a;
      font-size: 17px;
      font-weight: 650;
      letter-spacing: -0.2px;
    }
    .project-heading p {
      margin: 6px 0 0;
      color: var(--muted, #7a8598);
      font-size: 12px;
    }
    .project-side {
      display: flex;
      align-items: center;
      gap: 12px;
      flex: 0 0 auto;
    }
    .project-count {
      color: #4e6077;
      font-size: 12px;
      white-space: nowrap;
    }
    .project-heading a {
      padding: 7px 12px;
      border: 1px solid #dce4f2;
      border-radius: 7px;
      color: var(--primary, #315dde);
      background: #f8faff;
      font-size: 12px;
      font-weight: 550;
      white-space: nowrap;
    }
    .project-heading a:hover {
      border-color: #bac8df;
    }

    /* 三级：任务条目，栅格列对齐便于纵向扫读 */
    .work-item {
      display: grid;
      grid-template-columns: 13px minmax(0, 1fr) 92px 100px 96px 74px;
      align-items: center;
      gap: 14px;
      padding: 12px 22px;
      border-bottom: 1px solid #f0f2f6;
    }
    .work-item:last-child {
      border-bottom: 0;
    }
    .work-item:hover {
      background: #fafcff;
    }
    .item-mark {
      width: 9px;
      height: 9px;
      justify-self: center;
      border-radius: 50%;
      background: #e0a34a;
      box-shadow: 0 0 0 3px var(--surface, #fff);
      z-index: 1;
    }
    .work-item.completed .item-mark {
      background: #62b08f;
    }
    .item-content {
      min-width: 0;
    }
    .item-content strong,
    .item-content small {
      display: block;
    }
    .item-content strong {
      color: #2c3950;
      font-size: 13.5px;
      font-weight: 550;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .work-item.completed .item-content strong {
      color: #8a95a6;
    }
    .item-content small {
      margin-top: 3px;
      color: #4e6077;
      font-size: 11px;
      letter-spacing: 0.02em;
    }
    .item-owner {
      color: #5d6a80;
      font-size: 12px;
      white-space: nowrap;
    }
    .item-due {
      color: #4e6077;
      font-size: 12px;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .item-badge {
      min-width: 0;
    }
    .item-status {
      justify-self: start;
      padding: 5px 10px;
      border-radius: 12px;
      color: #966619;
      background: #fff5e5;
      font-size: 11px;
      white-space: nowrap;
    }
    .item-status.done {
      color: #26745b;
      background: #eaf6f0;
    }

    /* 四级：空态与脚注 */
    .empty-project,
    .empty-board {
      color: #7b8799;
      font-size: 12px;
    }
    .empty-project {
      padding: 15px 22px 15px 52px;
      margin: 0;
    }
    .empty-board {
      display: grid;
      justify-items: center;
      padding: 52px 24px;
      background: var(--surface, #fff);
      border: 1px dashed #dce2eb;
      border-radius: var(--radius, 10px);
      text-align: center;
    }
    .empty-board h2 {
      margin: 0 0 7px;
      color: #28364b;
      font-size: 16px;
    }
    .empty-board p {
      margin: 0 0 16px;
    }
    .board-footnote {
      margin: 18px 2px 0;
      color: #96a0af;
      font-size: 11px;
      line-height: 1.7;
    }

    @media (max-width: 700px) {
      .board-page {
        padding: 16px 12px 32px;
      }
      .page-heading {
        flex-direction: column;
        align-items: flex-start;
      }
      .project-heading {
        flex-wrap: wrap;
      }
      .project-side {
        margin-left: 28px;
      }
      .work-item {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 12px;
      }
      .item-content {
        flex-basis: calc(100% - 35px);
      }
      .item-owner {
        margin-left: 22px;
      }
      .item-due {
        order: 4;
      }
    }
  `,
})
export class ProjectBoard implements OnDestroy {
  readonly store = inject(DemoStore);
  readonly refreshedAt = signal(new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
  private readonly files = inject(SolutionFilesService);
  readonly availability = signal<Record<string, FileAvailability>>({});
  private fileRequest = 0;
  readonly dates = inject(SolutionClock).dates;
  readonly filters = signal<ManagementBoardFilters>(defaultBoardFilters());
  readonly firstResult = computed(() => this.filters().firstResults[0] ?? null);
  readonly section = signal('all');
  readonly advancedOpen = signal(false);
  readonly collaborationOpen = signal(false);
  readonly reducedMotion = signal(false);
  private restoredFocusHref: string | undefined;
  private restoredFocusKey: string | undefined;
  readonly viewError = signal<string | null>(null);
  private restoredY = 0;
  private departed = false;
  private readonly scope = computed(() => ({
    ...this.store.v9CommandTarget(),
    workspaceId: this.store.v9CommandTarget()?.workspaceId ?? 'unavailable',
    roundId: this.store.state().roundId ?? 'unavailable',
    route: '/projects/board',
  }));
  constructor() {
    effect((onCleanup) => {
      this.store.state();
      this.store.v9CommandTarget();
      untracked(() => void this.refreshFiles());
      onCleanup(() => {
        this.fileRequest++;
      });
    });
    effect(() => {
      const scope = this.scope();
      untracked(() => {
        this.departed = false;
        try {
          const saved = readBoardView(sessionStorage, scope);
          this.viewError.set(saved.error);
          if (saved.view) {
            this.filters.set(saved.view.filters);
            this.section.set(saved.view.section);
            this.advancedOpen.set(saved.view.advancedOpen ?? false);
            this.collaborationOpen.set(saved.view.collaborationOpen ?? false);
            this.restoredY = saved.view.scrollY;
            this.reducedMotion.set(saved.view.reducedMotion ?? false);
            this.restoredFocusHref = saved.view.focusHref;
            this.restoredFocusKey = saved.view.focusKey;
          } else {
            this.resetView();
            this.restoredY = 0;
            this.reducedMotion.set(false);
            this.restoredFocusHref = undefined;
            this.restoredFocusKey = undefined;
          }
        } catch {
          this.viewError.set('无法恢复浏览位置，已显示默认范围。');
        }
      });
    });
    afterNextRender(() => {
      requestAnimationFrame(() => {
        const links = [...document.querySelectorAll<HTMLAnchorElement>('.board-page a[href]')];
        const link = this.restoredFocusKey
          ? links.find((a) => a.dataset['boardFocus'] === this.restoredFocusKey)
          : links.find((a) => a.getAttribute('href') === this.restoredFocusHref);
        const target = link?.checkVisibility()
          ? link
          : this.restoredFocusHref
            ? document.querySelector<HTMLElement>('.board-filters select')
            : null;
        target?.focus({ preventScroll: true });
        window.scrollTo(0, this.restoredY);
      });
    });
  }
  persistView() {
    if (this.departed) return;
    try {
      this.viewError.set(
        saveBoardView(sessionStorage, this.scope(), {
          filters: this.filters(),
          section: this.section(),
          scrollY: window.scrollY,
          advancedOpen: this.advancedOpen(),
          collaborationOpen: this.collaborationOpen(),
          reducedMotion: this.reducedMotion(),
          focusKey:
            document.activeElement instanceof HTMLAnchorElement &&
            document.activeElement.closest('.board-page')
              ? document.activeElement.dataset['boardFocus']
              : this.restoredFocusKey,
          focusHref:
            document.activeElement instanceof HTMLAnchorElement &&
            document.activeElement.closest('.board-page')
              ? (document.activeElement.getAttribute('href') ?? undefined)
              : this.restoredFocusHref,
        }),
      );
    } catch {
      this.viewError.set('无法保存浏览位置，请在返回后重新筛选。');
    }
  }
  toggleMotion() {
    this.reducedMotion.update((v) => !v);
    this.persistView();
  }
  ngOnDestroy() {
    this.fileRequest++;
    this.persistView();
  }
  async refreshFiles() {
    const request = ++this.fileRequest;
    const versions = (this.store.state().solutionWorkspaces ?? []).flatMap((w) =>
      w.versions.filter((v) => Object.values(w.currentOutputs).includes(v.id)),
    );
    this.availability.set(Object.fromEntries(versions.map((v) => [v.id, 'checking' as const])));
    const results = await Promise.all(
      versions.map(async (v) => [v.id, await checkSolutionFile(this.files, v)] as const),
    );
    if (request !== this.fileRequest) return;
    this.availability.set(Object.fromEntries(results));
    this.refreshedAt.set(new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
  }
  change(key: keyof ManagementBoardFilters, value: string) {
    const scalar = ['query', 'partition', 'budgetCurrency'];
    this.filters.update((f) => ({
      ...f,
      [key]: scalar.includes(key) ? value : value ? [value] : [],
    }));
    this.persistView();
  }
  selectFirst(value: FirstFinalization['result'] | null) {
    this.filters.update((f) => ({ ...f, firstResults: value ? [value] : [] }));
    this.persistView();
  }
  selectDepartment(value: CompleteWorkItemView['department']) {
    this.change('departments', this.filters().departments.includes(value) ? '' : value);
  }
  selectStage(value: string) {
    this.change('stages', this.filters().stages?.includes(value) ? '' : value);
  }
  resetView() {
    this.filters.set(defaultBoardFilters());
    this.section.set('all');
    this.advancedOpen.set(false);
    this.collaborationOpen.set(false);
  }
  clearFilters() {
    this.filters.set(defaultBoardFilters());
    this.persistView();
  }
  readonly options = computed(() => ({
    regions: [
      ...new Set(
        this.store
          .state()
          .sales.filter((s) => s.type === 'opportunity')
          .map((s) => s.projectRegion)
          .filter((x): x is string => !!x),
      ),
    ],
    stages: [
      ...new Set(
        this.store
          .state()
          .sales.filter((s) => s.type === 'opportunity')
          .map((s) => s.stage),
      ),
    ],
    owners: [
      ...new Set(
        [
          ...this.store.state().sales.map((s) => s.owner),
          ...this.store.state().projects.map((p) => p.pm),
          ...selectCompleteWorkItems(this.store.state(), this.dates()).map(
            (i) => i.owner?.name ?? '',
          ),
        ].filter(Boolean),
      ),
    ],
  }));
  readonly businessTime = formatSolutionTime;
  readonly firstLabels = {
    early: '提前',
    'on-time': '按时',
    late: '逾期',
    'historical-unscored': '历史未评分',
    'not-finalized': '未首次定稿',
  };
  readonly currentLabels = {
    current: '组合已确认',
    stale: '待重新定稿',
    'not-finalized': '未定稿',
  };
  readonly fileKindLabels = {
    proposal: '技术方案',
    bom: '设计BOM',
    sld: '单线图',
    degradation: '衰减资料',
  };
  readonly fileLabels = {
    present: '文件可用',
    checking: '正在核验',
    missing: '缺件',
    unavailable: '暂不可读',
  };
  readonly solutionSummaries = computed(
    () =>
      new Map(
        this.businessIds().map((id) => {
          const view = selectSolutionWorkspace(this.store.state(), id, this.availability());
          return [
            id,
            {
              ...view,
              firstConfirmedAt: view.workspace?.finalizations.find(
                (e) => e.id === view.workspace?.firstFinalization?.eventId,
              )?.confirmedAt,
              files: view.files.map((f) => ({
                ...f,
                version: view.workspace?.versions.find((v) => v.id === f.versionId),
              })),
            },
          ];
        }),
      ),
  );
  readonly departmentLabels: Record<string, string> = {
    sales: '销售',
    solution: '解决方案',
    'pm-pmo': 'PM / PMO',
    service: '运维售后',
    unknown: '部门待核',
  };
  readonly toggleExceptions = (f: ManagementBoardFilters) => ({
    ...f,
    exceptionOnly: !f.exceptionOnly,
  });
  readonly currency = computed(() => this.filters().budgetCurrency ?? 'CNY');
  readonly chartBudgets = computed(() =>
    this.management().budgets.map((b) => ({
      ...b,
      budgetText: b.budgetMinor === null ? '待补' : formatBudgetAmount(b.budgetMinor, b.currency),
      expenseText:
        b.expenseMinor === null ? '待补' : formatBudgetAmount(b.expenseMinor, b.currency),
    })),
  );
  readonly statistics = computed(() =>
    selectManagementStatistics(
      this.store.state(),
      this.dates(),
      this.businessIds(),
      this.management().departmentItems,
    ),
  );
  readonly stageData = computed(() =>
    this.options().stages.map((id) => ({
      id,
      count: this.management().businesses.filter((b) => this.store.sale(b.businessId)?.stage === id)
        .length,
      total: this.management().businessCount,
    })),
  );
  target(href: string): UrlTree {
    const tree = this.router.parseUrl(href);
    tree.queryParams = {
      ...tree.queryParams,
      returnTo: '/projects/board',
      returnLabel: '返回高层项目总览',
    };
    return tree;
  }
  openSource(href: string) {
    this.leave();
    void this.router.navigateByUrl(this.target(href));
  }
  goSection(id: string) {
    this.section.set(id);
    document.getElementById('board-' + id)?.scrollIntoView();
    this.persistView();
  }
  leave() {
    this.persistView();
    this.departed = true;
  }
  source(businessId: string, kind: string): string {
    if (kind === 'solution') return `/sales/solutions/${encodeURIComponent(businessId)}`;
    if (kind === 'quote') return `/sales/quotes/${encodeURIComponent(businessId)}`;
    const b = this.management().businesses.find((x) => x.businessId === businessId);
    return b?.slowestProjectId
      ? `/projects/${encodeURIComponent(b.slowestProjectId)}?tab=${kind === 'acceptance' ? 'acceptance' : 'plans'}`
      : `/sales/detail/${encodeURIComponent(businessId)}`;
  }

  readonly partitions = [
    { id: 'presales', label: '售前' },
    { id: 'execution', label: '执行' },
  ] as const;
  readonly management = computed(() =>
    selectManagementBoard(this.store.state(), this.filters(), this.dates(), this.availability()),
  );
  readonly priorityTimeline = computed(() => {
    const items = this.management().topFive;
    const dated = items.filter((i) => i.startDate && i.deadlineDate);
    const start = dated.length ? dated.map((i) => i.startDate!).sort()[0] : null;
    const end = dated.length
      ? dated
          .map((i) => i.deadlineDate!)
          .sort()
          .at(-1)!
      : null;
    const from = start ? Date.parse(start) : 0;
    const span = start && end ? Date.parse(end) - from : 0;
    return {
      start,
      end,
      items: items.map((i) => ({
        ...i,
        leftPercent: span && i.startDate ? ((Date.parse(i.startDate) - from) / span) * 100 : 0,
        widthPercent:
          span && i.startDate && i.deadlineDate
            ? ((Date.parse(i.deadlineDate) - Date.parse(i.startDate)) / span) * 100
            : 0,
      })),
    };
  });
  readonly businessIds = computed(() => this.management().businesses.map((b) => b.businessId));
  hasPartition(partition: 'presales' | 'execution'): boolean {
    return this.management().businesses.some((b) => b.partition === partition);
  }
  private readonly router = inject(Router);
  readonly view = computed(() =>
    collectDemoProjectWorkItems(this.store.state(), this.store.person()),
  );
  readonly groups = computed(() =>
    this.store
      .state()
      .projects.filter((p) => this.management().projects.some((item) => item.projectId === p.id))
      .map((project) => ({
        project,
        items: this.view().items.filter(
          (item) => item.projectId === project.id && item.status === 'open',
        ),
      })),
  );
  readonly collaborationCount = computed(() =>
    this.groups().reduce((n, g) => n + g.items.length, 0),
  );
  readonly actionableExceptions = computed(() =>
    this.management().exceptions.filter((e) => !!e.category),
  );
  readonly exceptionSummary = computed(() =>
    [
      { id: 'delivery', label: '关键延期' },
      { id: 'solution-overdue', label: '方案逾期' },
      { id: 'over-budget', label: '超预算' },
      { id: 'missing', label: '待处理 / 待补' },
    ].map((group) => ({
      ...group,
      count: this.actionableExceptions().filter((e) => e.category === group.id).length,
    })),
  );
  partitionCount(partition: 'presales' | 'execution') {
    return this.management().businesses.filter((b) => b.partition === partition).length;
  }
  progressText(value: string) {
    return /^\d+(\.\d+)?$/.test(value) ? value + '%' : value;
  }
  toggleAdvanced(event: Event) {
    this.advancedOpen.set((event.target as HTMLDetailsElement).open);
    this.persistView();
  }
  toggleCollaboration(event: Event) {
    this.collaborationOpen.set((event.target as HTMLDetailsElement).open);
    this.persistView();
  }
  removeFilter(key: keyof ManagementBoardFilters, value: string) {
    this.filters.update((f) => {
      if (key === 'query') return { ...f, query: '' };
      if (key === 'partition') return { ...f, partition: 'all' };
      if (key === 'exceptionOnly') return { ...f, exceptionOnly: false };
      const values = f[key];
      return { ...f, [key]: Array.isArray(values) ? values.filter((v) => v !== value) : values };
    });
    this.persistView();
    requestAnimationFrame(() => {
      const next =
        [...document.querySelectorAll<HTMLElement>('.filter-context button')].find(
          (button) => button.dataset['filterKey'] === key,
        ) ?? document.querySelector<HTMLElement>('.board-filters select');
      next?.focus();
    });
  }
  readonly filterChips = computed(() => {
    const f = this.filters();
    const chips: { id: string; key: keyof ManagementBoardFilters; value: string; label: string }[] =
      [];
    const add = (key: keyof ManagementBoardFilters, value: string, label: string) =>
      chips.push({ id: JSON.stringify([key, value]), key, value, label });
    if (f.partition && f.partition !== 'all')
      add('partition', f.partition, '分区：' + (f.partition === 'presales' ? '售前' : '执行'));
    for (const [key, label] of [
      ['grades', '等级'],
      ['regions', '区域'],
      ['stages', '阶段'],
      ['departments', '部门'],
      ['owners', '负责人'],
      ['firstResults', '首次'],
      ['businessIds', '主线'],
      ['projectIds', '项目'],
    ] as const) {
      for (const value of f[key] ?? []) {
        const text =
          key === 'departments'
            ? this.departmentLabels[value]
            : key === 'firstResults'
              ? ({ early: '提前', 'on-time': '按时', late: '逾期' } as Record<string, string>)[
                  value
                ]
              : value;
        add(key, value, label + '：' + (text ?? value));
      }
    }
    if (f.query) add('query', f.query, '关键字：' + f.query);
    if (f.exceptionOnly) add('exceptionOnly', 'true', '仅异常业务');
    return chips;
  });
  /**
   * 待办 href 自带部门与动作查询参数，按 URL 解析后绑定，避免整串被当成单个路径段编码；
   * 同时写上来源返回上下文，统一容器才能渲染可用的返回入口。
   */
  workItemTarget(item: WorkItem): UrlTree | null {
    if (!item.href?.startsWith('/') || item.href.startsWith('//')) return null;
    const target = this.router.parseUrl(item.href);
    target.queryParams = {
      ...target.queryParams,
      returnTo: '/projects/board',
      returnLabel: '返回共享项目看板',
    };
    return target;
  }
}
