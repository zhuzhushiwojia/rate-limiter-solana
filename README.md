# Rate Limiter - Solana Program

**Bounty**: Rebuild Backend Systems - 1,000 USDC  
**Status**: ✅ Core Program Complete  
**Author**: 龙虾大总管 🦞

---

## 📋 概述

这是一个基于 Solana/Anchor 构建的链上速率限制系统，将传统 Web2 的速率限制逻辑重构为去中心化的 Solana Program。

### 核心功能

- ✅ **全局配置管理**: 设置默认的速率限制参数
- ✅ **用户级限制**: 为每个用户设置独立的速率限制
- ✅ **滑动窗口算法**: 基于时间窗口的请求计数
- ✅ **自动重置**: 窗口过期后自动重置计数器
- ✅ **权限控制**: 只有授权账户可以修改配置
- ✅ **事件发射**: 所有操作都发射事件供链下监听

---

## 🏗️ 架构设计

### Web2 vs Solana 对比

| 特性 | Web2 传统方案 | Solana 链上方案 |
|------|-------------|----------------|
| **存储** | Redis/Memory | Solana Accounts (PDA) |
| **状态管理** | 中心化服务器 | 去中心化链上状态 |
| **权限控制** | JWT/API Keys | Solana Signer + PDA |
| **计数器** | 内存/Redis | 链上 Account 字段 |
| **时间窗口** | 服务器时间 | Solana Clock Sysvar |
| **可组合性** | API 调用 | CPI (Cross-Program Invocation) |
| **透明度** | 黑盒 | 完全透明可验证 |
| **抗审查** | 依赖服务商 | 去中心化网络 |

### 账户结构

```
RateLimitConfig (PDA: ["rate_limit_config"])
├── authority: Pubkey          # 管理员账户
├── max_requests: u32          # 默认最大请求数
├── window_seconds: u64        # 时间窗口 (秒)
├── created_at: u64            # 创建时间戳
└── updated_at: u64            # 更新时间戳

UserRateLimit (PDA: ["user_rate_limit", user_id])
├── user_id: Pubkey            # 用户标识
├── max_requests: u32          # 用户最大请求数
├── window_seconds: u64        # 用户时间窗口
├── request_count: u32         # 当前窗口请求计数
├── window_start: u64          # 窗口开始时间
├── last_request: u64          # 最后请求时间
├── updated_at: u64            # 更新时间戳
└── bump: u8                   # PDA bump 种子
```

---

## 🚀 快速开始

### 环境要求

- Rust 1.89+
- Solana Tool Suite 1.18+
- Anchor 0.32.1
- Node.js 18+
- Yarn

### 安装依赖

```bash
# 安装 Anchor Version Manager
cargo install --git https://github.com/coral-xyz/anchor avm --force
avm install latest

# 安装项目依赖
cd rate-limiter
yarn install
```

### 构建程序

```bash
anchor build
```

### 运行测试

```bash
anchor test
```

### 部署到 Devnet

```bash
# 配置 Devnet
anchor config set cluster devnet

# 部署程序
anchor deploy
```

---

## 📖 API 参考

### 指令 (Instructions)

#### 1. `initialize`
初始化全局速率限制配置。

```typescript
await program.methods
  .initialize(maxRequests: u32, windowSeconds: u64)
  .accounts({
    authority: provider.wallet.publicKey,
    config: configPda,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

#### 2. `setUserLimit`
为特定用户设置速率限制。

```typescript
await program.methods
  .setUserLimit(userId: Pubkey, maxRequests: u32, windowSeconds: u64)
  .accounts({
    authority: provider.wallet.publicKey,
    config: configPda,
    userLimit: userLimitPda,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

#### 3. `checkRateLimit`
检查请求是否允许（返回布尔值）。

```typescript
const allowed = await program.methods
  .checkRateLimit(userId: Pubkey)
  .accounts({
    config: configPda,
    userLimit: userLimitPda,
  })
  .view();

if (allowed) {
  // 执行请求
} else {
  // 速率限制 exceeded
}
```

#### 4. `resetLimit`
重置用户的速率限制计数器。

```typescript
await program.methods
  .resetLimit(userId: Pubkey)
  .accounts({
    authority: provider.wallet.publicKey,
    config: configPda,
    userLimit: userLimitPda,
  })
  .rpc();
```

#### 5. `updateConfig`
更新全局配置。

```typescript
await program.methods
  .updateConfig(
    maxRequests: Option<u32>,
    windowSeconds: Option<u64>
  )
  .accounts({
    authority: provider.wallet.publicKey,
    config: configPda,
  })
  .rpc();
```

---

## 📊 事件 (Events)

程序发射以下事件：

| 事件 | 描述 |
|------|------|
| `RateLimitInitialized` | 配置初始化时触发 |
| `UserLimitSet` | 用户限制设置时触发 |
| `RateLimitChecked` | 每次检查速率限制时触发 |
| `RateLimitReset` | 用户限制重置时触发 |
| `ConfigUpdated` | 配置更新时触发 |

### 监听事件

```typescript
// 监听速率限制检查事件
program.addEventListener("RateLimitChecked", (event) => {
  console.log(`User ${event.userId} - Request ${event.requestCount}/${event.maxRequests} - Allowed: ${event.allowed}`);
});
```

---

## 🧪 测试覆盖

测试用例包括：

- ✅ 初始化配置
- ✅ 设置用户限制
- ✅ 允许限制内请求
- ✅ 阻止超限请求
- ✅ 重置计数器
- ✅ 重置后允许请求
- ✅ 更新配置
- ✅ 事件发射验证
- ✅ 多用户独立处理
- ✅ 未授权访问拒绝

运行测试：
```bash
anchor test
```

---

## 💡 使用场景

### 1. API 速率限制
为 API 服务提供去中心化的速率限制，防止滥用。

### 2. 空投资格控制
限制每个地址可以领取空投的次数。

### 3. NFT Mint 限制
控制每个钱包可以铸造的 NFT 数量。

### 4. 游戏动作限制
限制玩家在游戏中执行特定动作的频率。

### 5. 投票/治理
限制每个账户在治理提案中的投票次数。

---

## 🔒 安全考虑

### 重初始化攻击防护
使用 PDA (Program Derived Address) 确保配置账户只能创建一次。

### 权限控制
所有管理操作都需要 `authority` 签名，防止未授权访问。

### 时间戳验证
使用 Solana 的 Clock Sysvar 获取可信的链上时间。

### 整数溢出防护
使用 `saturating_add` 和 `saturating_sub` 防止整数溢出。

---

## 📈 Gas 优化

### 账户空间优化
- 使用 `InitSpace` derive 宏精确计算所需空间
- 仅存储必要字段，减少租金成本

### 计算优化
- 使用高效的滑动窗口算法
- 避免不必要的账户访问

---

## 🔗 相关链接

- **Program ID (Devnet)**: `HzcpN3BLJ19g1M12kMAuragRcQX9AmPMbFZt6VqqdiTr`
- **GitHub**: https://github.com/zhuzhushiwojia/rate-limiter-solana
- **Bounty Submission**: https://github.com/zhuzhushiwojia/rate-limiter-solana/issues/1
- **Deployment Report**: https://github.com/zhuzhushiwojia/rate-limiter-solana/blob/main/DEPLOYMENT_REPORT.md
- **Anchor Docs**: https://www.anchor-lang.com
- **Solana Cookbook**: https://solanacookbook.com

---

## 📝 更新日志

### v0.1.0 (2026-03-14)
- ✅ 初始版本发布
- ✅ 核心速率限制功能
- ✅ 完整测试覆盖
- ✅ 文档完善

---

## 🏆 Bounty 提交清单

- [x] Rust (Anchor) Program 实现
- [x] Devnet 部署
- [x] 公开 GitHub 仓库
- [x] README 架构说明
- [x] 完整测试套件
- [x] 客户端示例 (TypeScript)
- [ ] 前端演示 (可选)

---

*最后更新：2026-03-14 20:45 GMT+8*
