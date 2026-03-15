import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { RateLimiter } from "../target/types/rate_limiter";
import { assert } from "chai";

describe("rate-limiter", () => {
  // 配置 Anchor 提供者
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.RateLimiter as Program<RateLimiter>;

  // 测试账户
  const authority = provider.wallet;
  let configPda: anchor.web3.PublicKey;
  let userPda: anchor.web3.PublicKey;

  // 测试配置
  const windowSize = new anchor.BN(60); // 60 秒窗口
  const maxRequests = new anchor.BN(10); // 每窗口最多 10 次请求

  before(async () => {
    // 派生配置 PDA
    [configPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("rate_limit_config")],
      program.programId
    );

    // 派生用户 PDA (使用 authority 作为测试用户)
    [userPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("user_rate_limit"), authority.publicKey.toBuffer()],
      program.programId
    );
  });

  it("初始化速率限制配置", async () => {
    const tx = await program.methods
      .initialize(windowSize, maxRequests)
      .accounts({
        config: configPda,
        authority: authority.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("初始化交易:", tx);

    // 验证配置
    const config = await program.account.rateLimitConfig.fetch(configPda);
    assert.strictEqual(config.authority.toString(), authority.publicKey.toString());
    assert.strictEqual(config.windowSize.toNumber(), 60);
    assert.strictEqual(config.maxRequests.toNumber(), 10);
    assert.isTrue(config.enabled);
  });

  it("成功检查速率限制 (首次请求)", async () => {
    const tx = await program.methods
      .checkRateLimit()
      .accounts({
        config: configPda,
        userLimit: userPda,
        payer: authority.publicKey,
        user: authority.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("检查速率限制交易:", tx);

    // 验证用户限制状态
    const userLimit = await program.account.userRateLimit.fetch(userPda);
    assert.strictEqual(userLimit.requestCount.toNumber(), 1);
    assert.strictEqual(userLimit.totalRequests.toNumber(), 1);
  });

  it("连续请求直到接近限制", async () => {
    // 再发起 8 次请求 (总共 9 次)
    for (let i = 0; i < 8; i++) {
      await program.methods
        .checkRateLimit()
        .accounts({
          config: configPda,
          userLimit: userPda,
          payer: authority.publicKey,
          user: authority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    }

    const userLimit = await program.account.userRateLimit.fetch(userPda);
    assert.strictEqual(userLimit.requestCount.toNumber(), 9);
    assert.strictEqual(userLimit.totalRequests.toNumber(), 9);
  });

  it("第 10 次请求成功 (达到限制)", async () => {
    await program.methods
      .checkRateLimit()
      .accounts({
        config: configPda,
        userLimit: userPda,
        payer: authority.publicKey,
        user: authority.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const userLimit = await program.account.userRateLimit.fetch(userPda);
    assert.strictEqual(userLimit.requestCount.toNumber(), 10);
  });

  it("第 11 次请求失败 (超过限制)", async () => {
    try {
      await program.methods
        .checkRateLimit()
        .accounts({
          config: configPda,
          userLimit: userPda,
          payer: authority.publicKey,
          user: authority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      
      assert.fail("应该抛出速率限制错误");
    } catch (error: any) {
      assert.include(error.message, "RateLimitExceeded");
      console.log("✓ 正确抛出速率限制错误");
    }
  });

  it("管理员更新配置", async () => {
    const newWindowSize = new anchor.BN(120); // 120 秒
    const newMaxRequests = new anchor.BN(20); // 20 次请求

    await program.methods
      .updateConfig(newWindowSize, newMaxRequests, null)
      .accounts({
        config: configPda,
        authority: authority.publicKey,
      })
      .rpc();

    const config = await program.account.rateLimitConfig.fetch(configPda);
    assert.strictEqual(config.windowSize.toNumber(), 120);
    assert.strictEqual(config.maxRequests.toNumber(), 20);
  });

  it("非管理员更新配置失败", async () => {
    const randomUser = anchor.web3.Keypair.generate();
    
    try {
      await program.methods
        .updateConfig(windowSize, maxRequests, null)
        .accounts({
          config: configPda,
          authority: randomUser.publicKey,
        })
        .signers([randomUser])
        .rpc();
      
      assert.fail("应该抛出未授权错误");
    } catch (error: any) {
      assert.include(error.message, "Unauthorized");
      console.log("✓ 正确抛出未授权错误");
    }
  });

  it("管理员重置用户限制", async () => {
    await program.methods
      .resetUserLimit()
      .accounts({
        config: configPda,
        userLimit: userPda,
        authority: authority.publicKey,
      })
      .rpc();

    const userLimit = await program.account.userRateLimit.fetch(userPda);
    assert.strictEqual(userLimit.requestCount.toNumber(), 0);
    console.log("✓ 用户限制已重置");
  });

  it("获取用户状态", async () => {
    // 先发起几次请求
    for (let i = 0; i < 5; i++) {
      await program.methods
        .checkRateLimit()
        .accounts({
          config: configPda,
          userLimit: userPda,
          payer: authority.publicKey,
          user: authority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    }

    const status = await program.methods
      .getUserStatus()
      .accounts({
        config: configPda,
        userLimit: userPda,
        user: authority.publicKey,
      })
      .view();

    assert.strictEqual(status.requestCount.toNumber(), 5);
    assert.strictEqual(status.maxRequests.toNumber(), 20);
    assert.strictEqual(status.remaining.toNumber(), 15);
    console.log("用户状态:", {
      requestCount: status.requestCount.toNumber(),
      maxRequests: status.maxRequests.toNumber(),
      remaining: status.remaining.toNumber(),
      resetTime: new Date(status.resetTime.toNumber() * 1000).toISOString(),
    });
  });

  it("禁用速率限制", async () => {
    await program.methods
      .updateConfig(null, null, false)
      .accounts({
        config: configPda,
        authority: authority.publicKey,
      })
      .rpc();

    const config = await program.account.rateLimitConfig.fetch(configPda);
    assert.isFalse(config.enabled);
  });

  it("禁用后请求总是成功", async () => {
    // 即使之前达到限制，现在也应该成功
    await program.methods
      .checkRateLimit()
      .accounts({
        config: configPda,
        userLimit: userPda,
        payer: authority.publicKey,
        user: authority.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("✓ 禁用后请求成功");
  });
});
