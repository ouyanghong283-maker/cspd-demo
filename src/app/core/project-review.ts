import { BASE_DATE, Plan, Project, ProjectReviewReason } from './models';

export const PROJECT_REVIEW_LABELS: Record<ProjectReviewReason, string> = {
  briefing: '启动交底',
  sat: 'SAT测试',
  acceptance: '客户验收',
  handover: '内部移交',
};
const COMPLETION_KINDS: Record<string, ProjectReviewReason> = {
  项目启动交底: 'briefing',
  调试测试: 'sat',
  客户验收: 'acceptance',
  内部移交: 'handover',
};

export function completionKind(
  plan: Pick<Plan, 'type' | 'name' | 'completionKind'>,
): ProjectReviewReason | undefined {
  return plan.type === '内部WBS' ? plan.completionKind || COMPLETION_KINDS[plan.name] : undefined;
}

export function initializeProjectReview(project: Project): void {
  // Before independent reasons existed, only the SAT draft path set this flag.
  project.reviewReasons ??= project.needsReview ? ['sat'] : [];
  for (const plan of project.plans) {
    const kind = completionKind(plan);
    if (kind) plan.completionKind ??= kind;
  }
  project.needsReview = project.reviewReasons.length > 0;
}

export function setProjectReview(
  project: Project,
  reason: ProjectReviewReason,
  required: boolean,
): void {
  initializeProjectReview(project);
  project.reviewReasons = project.reviewReasons!.filter((item) => item !== reason);
  if (required) project.reviewReasons.push(reason);
  project.needsReview = project.reviewReasons.length > 0;
}

export function syncProjectCompletion(project: Project): void {
  initializeProjectReview(project);
  for (const plan of project.plans) {
    const kind = completionKind(plan);
    if (!kind) continue;
    if (project.reviewReasons!.includes(kind)) {
      plan.status = '需复核';
      plan.actual = '';
      continue;
    }
    if (kind === 'briefing') {
      if (project.briefing.submission) {
        if (project.briefing.startupHandover?.status === '已移交') {
          plan.status = '已完成';
          plan.actual ||= project.briefing.startupHandover.transferredAt.slice(0, 10) || BASE_DATE;
        } else {
          plan.status = '进行中';
          plan.actual = '';
        }
        continue;
      }
      if (plan.status === '需复核' && ['通过', '附条件通过'].includes(project.briefing.review)) {
        plan.status = '进行中';
        plan.actual = '';
      }
      continue;
    }
    const complete =
      kind === 'sat'
        ? project.sat.complete
        : kind === 'acceptance'
          ? project.acceptanceComplete
          : project.handover.status === '已接收';
    if (complete) {
      plan.status = '已完成';
      plan.actual ||=
        kind === 'sat'
          ? project.sat.date || BASE_DATE
          : kind === 'acceptance'
            ? project.acceptance
                .map((item) => item.date)
                .sort()
                .at(-1) || BASE_DATE
            : BASE_DATE;
    } else if (plan.status === '已完成' || plan.status === '需复核') {
      plan.status = '进行中';
      plan.actual = '';
    }
  }
}
