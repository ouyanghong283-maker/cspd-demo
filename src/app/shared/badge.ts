import { ChangeDetectionStrategy, Component, input } from '@angular/core';
@Component({
  selector: 'app-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span
    class="badge"
    [class.green]="green()"
    [class.amber]="amber()"
    [class.red]="red()"
    [class.blue]="blue()"
    >{{ text() }}</span
  >`,
})
export class Badge {
  text = input('');
  green = () =>
    /完成|通过|赢单|接收|合格|已确认/.test(this.text()) &&
    !/未|不合格|附条件|待接收/.test(this.text());
  amber = () => /待|条件|暂缓|未确认|未开始|草稿/.test(this.text());
  red = () => /退回|丢单|归档|复核|不合格/.test(this.text());
  blue = () => /进行|跟进|报价|模拟审核|谈判|洽谈|已提交/.test(this.text());
}
