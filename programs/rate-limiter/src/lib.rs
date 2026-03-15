use anchor_lang::prelude::*;
use anchor_lang::solana_program::clock;

declare_id!("HzcpN3BLJ19g1M12kMAuragRcQX9AmPMbFZt6VqqdiTr");

#[program]
pub mod rate_limiter {
    use super::*;

    /// Initialize the rate limiter configuration
    pub fn initialize(ctx: Context<Initialize>, max_requests: u32, window_seconds: u64) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.max_requests = max_requests;
        config.window_seconds = window_seconds;
        config.created_at = clock::Clock::get()?.unix_timestamp as u64;
        config.updated_at = config.created_at;
        
        emit!(RateLimitInitialized {
            authority: ctx.accounts.authority.key(),
            max_requests,
            window_seconds,
        });
        
        msg!("Rate limiter initialized: {} requests per {} seconds", max_requests, window_seconds);
        Ok(())
    }

    /// Set or update rate limit for a specific user/identifier
    pub fn set_user_limit(ctx: Context<SetUserLimit>, user_id: Pubkey, max_requests: u32, window_seconds: u64) -> Result<()> {
        require!(
            ctx.accounts.config.authority == ctx.accounts.authority.key(),
            RateLimiterError::Unauthorized
        );

        let user_limit = &mut ctx.accounts.user_limit;
        user_limit.user_id = user_id;
        user_limit.max_requests = max_requests;
        user_limit.window_seconds = window_seconds;
        user_limit.request_count = 0;
        user_limit.window_start = clock::Clock::get()?.unix_timestamp as u64;
        user_limit.last_request = 0;
        user_limit.updated_at = clock::Clock::get()?.unix_timestamp as u64;
        user_limit.bump = ctx.bumps.user_limit;

        emit!(UserLimitSet {
            user_id,
            max_requests,
            window_seconds,
        });

        msg!("User limit set for {:?}: {} requests per {} seconds", user_id, max_requests, window_seconds);
        Ok(())
    }

    /// Check if a request is allowed and increment counter if so
    pub fn check_rate_limit(ctx: Context<CheckRateLimit>, user_id: Pubkey) -> Result<bool> {
        let user_limit = &mut ctx.accounts.user_limit;
        let current_time = clock::Clock::get()?.unix_timestamp as u64;

        // Check if window has expired, reset if so
        let window_elapsed = current_time.saturating_sub(user_limit.window_start);
        if window_elapsed >= user_limit.window_seconds {
            user_limit.request_count = 0;
            user_limit.window_start = current_time;
        }

        // Check if under limit
        let allowed = user_limit.request_count < user_limit.max_requests;
        
        if allowed {
            user_limit.request_count = user_limit.request_count.saturating_add(1);
            user_limit.last_request = current_time;
        }

        emit!(RateLimitChecked {
            user_id,
            request_count: user_limit.request_count,
            max_requests: user_limit.max_requests,
            allowed,
        });

        msg!("Rate limit check for {:?}: {} / {} - Allowed: {}", 
             user_id, user_limit.request_count, user_limit.max_requests, allowed);
        
        Ok(allowed)
    }

    /// Reset the rate limit counter for a user
    pub fn reset_limit(ctx: Context<ResetLimit>, user_id: Pubkey) -> Result<()> {
        require!(
            ctx.accounts.config.authority == ctx.accounts.authority.key(),
            RateLimiterError::Unauthorized
        );

        let user_limit = &mut ctx.accounts.user_limit;
        user_limit.request_count = 0;
        user_limit.window_start = clock::Clock::get()?.unix_timestamp as u64;
        user_limit.updated_at = clock::Clock::get()?.unix_timestamp as u64;

        emit!(RateLimitReset {
            user_id,
        });

        msg!("Rate limit reset for {:?}", user_id);
        Ok(())
    }

    /// Update global configuration
    pub fn update_config(ctx: Context<UpdateConfig>, max_requests: Option<u32>, window_seconds: Option<u64>) -> Result<()> {
        require!(
            ctx.accounts.config.authority == ctx.accounts.authority.key(),
            RateLimiterError::Unauthorized
        );

        let config = &mut ctx.accounts.config;
        if let Some(max) = max_requests {
            config.max_requests = max;
        }
        if let Some(window) = window_seconds {
            config.window_seconds = window;
        }
        config.updated_at = clock::Clock::get()?.unix_timestamp as u64;

        emit!(ConfigUpdated {
            max_requests: config.max_requests,
            window_seconds: config.window_seconds,
        });

        msg!("Configuration updated");
        Ok(())
    }
}

// Account structures

#[account]
#[derive(InitSpace)]
pub struct RateLimitConfig {
    pub authority: Pubkey,
    pub max_requests: u32,
    pub window_seconds: u64,
    pub created_at: u64,
    pub updated_at: u64,
}

#[account]
#[derive(InitSpace)]
pub struct UserRateLimit {
    pub user_id: Pubkey,
    pub max_requests: u32,
    pub window_seconds: u64,
    pub request_count: u32,
    pub window_start: u64,
    pub last_request: u64,
    pub updated_at: u64,
    pub bump: u8,
}

// Context structures

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        init,
        payer = authority,
        space = 8 + RateLimitConfig::INIT_SPACE,
        seeds = [b"rate_limit_config"],
        bump,
    )]
    pub config: Account<'info, RateLimitConfig>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(user_id: Pubkey)]
pub struct SetUserLimit<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub config: Account<'info, RateLimitConfig>,
    
    #[account(
        init,
        payer = authority,
        space = 8 + UserRateLimit::INIT_SPACE,
        seeds = [b"user_rate_limit", user_id.as_ref()],
        bump,
    )]
    pub user_limit: Account<'info, UserRateLimit>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(user_id: Pubkey)]
pub struct CheckRateLimit<'info> {
    pub config: Account<'info, RateLimitConfig>,
    
    #[account(
        mut,
        seeds = [b"user_rate_limit", user_id.as_ref()],
        bump,
    )]
    pub user_limit: Account<'info, UserRateLimit>,
}

#[derive(Accounts)]
#[instruction(user_id: Pubkey)]
pub struct ResetLimit<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub config: Account<'info, RateLimitConfig>,
    
    #[account(
        mut,
        seeds = [b"user_rate_limit", user_id.as_ref()],
        bump,
    )]
    pub user_limit: Account<'info, UserRateLimit>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"rate_limit_config"],
        bump,
    )]
    pub config: Account<'info, RateLimitConfig>,
}

// Events

#[event]
pub struct RateLimitInitialized {
    pub authority: Pubkey,
    pub max_requests: u32,
    pub window_seconds: u64,
}

#[event]
pub struct UserLimitSet {
    pub user_id: Pubkey,
    pub max_requests: u32,
    pub window_seconds: u64,
}

#[event]
pub struct RateLimitChecked {
    pub user_id: Pubkey,
    pub request_count: u32,
    pub max_requests: u32,
    pub allowed: bool,
}

#[event]
pub struct RateLimitReset {
    pub user_id: Pubkey,
}

#[event]
pub struct ConfigUpdated {
    pub max_requests: u32,
    pub window_seconds: u64,
}

// Errors

#[error_code]
pub enum RateLimiterError {
    #[msg("Unauthorized: only authority can perform this action")]
    Unauthorized,
    #[msg("Rate limit exceeded")]
    RateLimitExceeded,
    #[msg("Invalid configuration")]
    InvalidConfig,
}
