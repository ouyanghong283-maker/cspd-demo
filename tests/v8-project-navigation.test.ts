import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { DemoStore } from '../src/app/core/store';
import { confirmProjectEntry, confirmProjectExit } from '../src/app/core/project-navigation-exit';

test('项目导航拒绝丢弃未保存的内嵌输入，保留草稿；确认后才清理', () => {
  const dialog = signal(null);
  const pendingInlineEdit = signal(true);
  const injector = Injector.create({
    providers: [{ provide: DemoStore, useValue: { ui: { dialog }, pendingInlineEdit } }],
  });
  const previous = globalThis.window;
  let confirmCount = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      confirm: () => {
        confirmCount++;
        return false;
      },
    },
  });
  try {
    assert.equal(
      runInInjectionContext(injector, () => confirmProjectEntry({} as never, {} as never)),
      false,
    );
    assert.equal(pendingInlineEdit(), true);
    assert.equal(confirmCount, 1);
    globalThis.window.confirm = () => true;
    assert.equal(
      runInInjectionContext(injector, () =>
        confirmProjectExit({}, {} as never, {} as never, {} as never),
      ),
      true,
    );
    assert.equal(pendingInlineEdit(), false);
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: previous });
  }
});
