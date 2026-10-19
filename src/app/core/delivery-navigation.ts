export type DeliveryTab = 'logistics' | 'service' | 'overview';

export function deliveryTab(value: string | null): DeliveryTab {
  return value === 'service' || value === 'overview' ? value : 'logistics';
}

export function deliveryPage(value: string | null): 'logistics' | 'service' | 'plans' {
  const tab = deliveryTab(value);
  return tab === 'overview' ? 'plans' : tab;
}
