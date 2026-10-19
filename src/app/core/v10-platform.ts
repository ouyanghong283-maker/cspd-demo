/** Angular页面公共入口；纯查询／CLI继续从v10-contracts导入，避免加载浏览器依赖。 */
export { useV10ReadContext } from './management-v10-platform/read-context';
export { buildV10Target, openV10Target } from './v10-contracts';

export { useV10ViewNavigation } from './management-v10-platform/view-navigation';
export {
  createV10ViewSession,
  isV10LocalTarget,
  defaultV10ViewFilters,
} from './management-v10-platform/view-state';
export type {
  V10ViewScope,
  V10ViewState,
  V10ViewFilters,
} from './management-v10-platform/view-state';

export { formatV10Money, formatV10Percent } from './management-v10-platform/format';
