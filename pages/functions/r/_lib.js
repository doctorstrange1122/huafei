// 转发到上层共享逻辑，避免与 ../_lib.js 重复维护（iOS 跳转等修复均在 ../_lib.js）
export * from '../_lib.js';
