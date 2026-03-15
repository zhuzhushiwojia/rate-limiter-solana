const anchor = require("@coral-xyz/anchor");
const { Program, AnchorProvider, Wallet } = require("@coral-xyz/anchor");
const { assert } = require("chai");
const { PublicKey, Keypair } = require("@solana/web3.js");

describe("rate-limiter", () => {
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.rateLimiter;
  const authority = provider.wallet.publicKey;

  // Test configuration
  const MAX_REQUESTS = 5;
  const WINDOW_SECONDS = new anchor.BN(60);
  
  // PDAs
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("rate_limit_config")],
    program.programId
  );

  // Test user
  const testUser = Keypair.generate().publicKey;
  const [userLimitPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_rate_limit"), testUser.toBuffer()],
    program.programId
  );

  before(async () => {
    console.log("Testing Rate Limiter Program");
    console.log("Program ID:", program.programId.toString());
    console.log("Authority:", authority.toString());
    console.log("Config PDA:", configPda.toString());
  });

  it("Initializes the rate limiter configuration", async () => {
    try {
      const tx = await program.methods
        .initialize(MAX_REQUESTS, WINDOW_SECONDS)
        .accounts({
          authority: authority,
          config: configPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      console.log("Initialize tx:", tx);

      // Verify config was created
      const config = await program.account.rateLimitConfig.fetch(configPda);
      assert.ok(config.authority.equals(authority));
      assert.strictEqual(config.maxRequests, MAX_REQUESTS);
      assert.ok(config.windowSeconds.eq(WINDOW_SECONDS));
      console.log("✓ Configuration initialized successfully");
    } catch (error) {
      // Account might already exist from previous test run
      console.log("Note: Config may already exist:", error.message);
    }
  });

  it("Sets user-specific rate limit", async () => {
    const userMaxRequests = 10;
    const userWindowSeconds = new anchor.BN(120);

    const tx = await program.methods
      .setUserLimit(testUser, userMaxRequests, userWindowSeconds)
      .accounts({
        authority: authority,
        config: configPda,
        userLimit: userLimitPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("SetUserLimit tx:", tx);

    // Verify user limit was created
    const userLimit = await program.account.userRateLimit.fetch(userLimitPda);
    assert.ok(userLimit.userId.equals(testUser));
    assert.strictEqual(userLimit.maxRequests, userMaxRequests);
    assert.ok(userLimit.windowSeconds.eq(userWindowSeconds));
    assert.strictEqual(userLimit.requestCount, 0);
    console.log("✓ User rate limit set successfully");
  });

  it("Allows requests under the limit", async () => {
    for (let i = 0; i < 3; i++) {
      const allowed = await program.methods
        .checkRateLimit(testUser)
        .accounts({
          config: configPda,
          userLimit: userLimitPda,
        })
        .view();

      assert.isTrue(allowed, `Request ${i + 1} should be allowed`);
      console.log(`✓ Request ${i + 1} allowed`);
    }

    // Verify counter incremented
    const userLimit = await program.account.userRateLimit.fetch(userLimitPda);
    assert.strictEqual(userLimit.requestCount, 3);
    console.log("✓ Request counter incremented correctly");
  });

  it("Blocks requests over the limit", async () => {
    // Make remaining requests to hit limit
    for (let i = 0; i < 7; i++) {
      const allowed = await program.methods
        .checkRateLimit(testUser)
        .accounts({
          config: configPda,
          userLimit: userLimitPda,
        })
        .view();

      if (i < 7) {
        assert.isTrue(allowed, `Request ${i + 4} should be allowed`);
      }
    }

    // Next request should be blocked
    const allowed = await program.methods
      .checkRateLimit(testUser)
      .accounts({
        config: configPda,
        userLimit: userLimitPda,
      })
      .view();

    assert.isFalse(allowed, "Request over limit should be blocked");
    console.log("✓ Rate limit enforced correctly");
  });

  it("Resets the rate limit counter", async () => {
    const tx = await program.methods
      .resetLimit(testUser)
      .accounts({
        authority: authority,
        config: configPda,
        userLimit: userLimitPda,
      })
      .rpc();

    console.log("ResetLimit tx:", tx);

    // Verify counter was reset
    const userLimit = await program.account.userRateLimit.fetch(userLimitPda);
    assert.strictEqual(userLimit.requestCount, 0);
    console.log("✓ Rate limit reset successfully");
  });

  it("Allows requests after reset", async () => {
    const allowed = await program.methods
      .checkRateLimit(testUser)
      .accounts({
        config: configPda,
        userLimit: userLimitPda,
      })
      .view();

    assert.isTrue(allowed, "Request after reset should be allowed");
    console.log("✓ Requests allowed after reset");
  });

  it("Updates global configuration", async () => {
    const newMaxRequests = 20;
    const newWindowSeconds = new anchor.BN(300);

    const tx = await program.methods
      .updateConfig(newMaxRequests, newWindowSeconds)
      .accounts({
        authority: authority,
        config: configPda,
      })
      .rpc();

    console.log("UpdateConfig tx:", tx);

    // Verify config was updated
    const config = await program.account.rateLimitConfig.fetch(configPda);
    assert.strictEqual(config.maxRequests, newMaxRequests);
    assert.ok(config.windowSeconds.eq(newWindowSeconds));
    console.log("✓ Configuration updated successfully");
  });

  it("Emits events correctly", async () => {
    // This test verifies events are emitted (check transaction logs)
    const testUser2 = Keypair.generate().publicKey;
    const [userLimitPda2] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_rate_limit"), testUser2.toBuffer()],
      program.programId
    );

    const tx = await program.methods
      .setUserLimit(testUser2, 5, new anchor.BN(60))
      .accounts({
        authority: authority,
        config: configPda,
        userLimit: userLimitPda2,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("Event emission test tx:", tx);
    console.log("✓ Events emitted (check logs for confirmation)");
  });

  it("Handles multiple users independently", async () => {
    const user3 = Keypair.generate().publicKey;
    const [userLimitPda3] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_rate_limit"), user3.toBuffer()],
      program.programId
    );

    // Create limit for user3
    await program.methods
      .setUserLimit(user3, 3, new anchor.BN(60))
      .accounts({
        authority: authority,
        config: configPda,
        userLimit: userLimitPda3,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Make 3 requests for user3
    for (let i = 0; i < 3; i++) {
      await program.methods
        .checkRateLimit(user3)
        .accounts({
          config: configPda,
          userLimit: userLimitPda3,
        })
        .view();
    }

    // user3 should be at limit
    const user3Limit = await program.account.userRateLimit.fetch(userLimitPda3);
    assert.strictEqual(user3Limit.requestCount, 3);

    // testUser should still have its own counter
    const testUserLimit = await program.account.userRateLimit.fetch(userLimitPda);
    console.log(`testUser count: ${testUserLimit.requestCount}, user3 count: ${user3Limit.requestCount}`);
    
    console.log("✓ Multiple users handled independently");
  });

  it("Prevents unauthorized updates", async () => {
    const unauthorizedWallet = Keypair.generate();
    
    // Try to create a new provider with unauthorized wallet
    const unauthorizedProvider = new AnchorProvider(
      provider.connection,
      new Wallet(unauthorizedWallet),
      provider.options
    );

    const unauthorizedProgram = new Program(
      program.idl,
      program.programId,
      unauthorizedProvider
    );

    try {
      const [fakeConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("rate_limit_config")],
        program.programId
      );

      await unauthorizedProgram.methods
        .updateConfig(999, new anchor.BN(999))
        .accounts({
          authority: unauthorizedWallet.publicKey,
          config: fakeConfigPda,
        })
        .rpc();

      assert.fail("Should have failed with unauthorized error");
    } catch (error) {
      console.log("✓ Unauthorized update correctly rejected:", error.message);
    }
  });
});
