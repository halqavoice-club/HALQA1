'use strict';
/**
 * Economy Reconciliation Worker — Task 12.2
 * ─────────────────────────────────────────────────────────────────────────────
 * READ-ONLY worker. Never modifies wallet balances.
 *
 * Runs daily at 02:00 UTC via the economy-reconciliation BullMQ queue.
 *
 * What it checks:
 *   For each wallet, compute expected coin balance = SUM(WalletTransaction.coins).
 *   Compare against Wallet.coins. If delta != 0, log an error and increment
 *   the economy_reconciliation_discrepancies_total Prometheus counter.
 *
 * Why it's safe:
 *   - Only SELECT queries — no UPDATE, DELETE, or INSERT.
 *   - Discrepancies are reported, not auto-corrected.
 *   - Any correction requires explicit admin authorization and audit logging.
 *
 * Discrepancy sources that are expected and non-critical:
 *   - Wallets created before the WalletTransaction ledger was introduced (Phase 3).
 *     These will show a delta equal to their pre-ledger balance.
 *   - The delta for these accounts will be stable (constant), not growing.
 *
 * Prometheus metrics:
 *   economy_reconciliation_discrepancies_total  (counter)
 *   economy_reconciliation_last_run_timestamp   (gauge, Unix seconds)
 *   economy_reconciliation_wallets_checked      (gauge)
 */

const { Worker } = require('bullmq');
const logger     = require('../utils/logger');

// ─── Prometheus metrics ────────────────────────────────────────────────────────
// Lazy-load to avoid crash if prometheus is not configured
function getMetrics() {
  try {
    const prom = require('../utils/prometheus');
    return prom;
  } catch {
    return null;
  }
}

// ─── Worker factory ────────────────────────────────────────────────────────────
function createEconomyReconciliationWorker(connection) {
  const worker = new Worker(
    'economy-reconciliation',
    async (job) => {
      const prisma  = require('../utils/prisma');
      const prom    = getMetrics();
      const batchSize = parseInt(process.env.RECONCILIATION_BATCH_SIZE || '500', 10);

      logger.info('[economy-reconciliation] Starting daily wallet reconciliation run…');

      let walletsChecked    = 0;
      let discrepancyCount  = 0;
      let cursor            = null;   // ID cursor for pagination

      // Process wallets in batches to avoid loading the entire table into memory
      while (true) {
        const batch = await prisma.wallet.findMany({
          take:    batchSize,
          skip:    cursor ? 1 : 0,
          cursor:  cursor ? { id: cursor } : undefined,
          orderBy: { id: 'asc' },
          select:  { id: true, userId: true, coins: true },
        });

        if (batch.length === 0) break;

        // Batch aggregate: compute expected coins for all userIds in this batch
        const userIds = batch.map(w => w.userId);

        // Use groupBy to get per-user ledger sum in one query
        const ledgerAggs = await prisma.walletTransaction.groupBy({
          by:     ['userId'],
          where:  { userId: { in: userIds } },
          _sum:   { coins: true },
        });

        const ledgerMap = Object.fromEntries(
          ledgerAggs.map(a => [a.userId, a._sum.coins ?? 0])
        );

        // Compare each wallet against ledger sum
        for (const wallet of batch) {
          const expected = ledgerMap[wallet.userId] ?? 0;
          const actual   = wallet.coins;
          const delta    = actual - expected;

          walletsChecked++;

          if (delta !== 0) {
            discrepancyCount++;
            logger.error('[economy-reconciliation] Wallet discrepancy detected', {
              userId:   wallet.userId,
              walletId: wallet.id,
              expected,
              actual,
              delta,
            });

            if (prom?.economyReconciliationDiscrepanciesTotal) {
              prom.economyReconciliationDiscrepanciesTotal.inc();
            }
          }
        }

        cursor = batch[batch.length - 1].id;
        if (batch.length < batchSize) break;

        // Brief yield between batches to reduce sustained DB pressure
        await new Promise(r => setTimeout(r, 50));
      }

      // Update Prometheus gauges
      if (prom) {
        if (prom.economyReconciliationLastRunTimestamp) {
          prom.economyReconciliationLastRunTimestamp.set(Math.floor(Date.now() / 1000));
        }
        if (prom.economyReconciliationWalletsChecked) {
          prom.economyReconciliationWalletsChecked.set(walletsChecked);
        }
      }

      if (discrepancyCount === 0) {
        logger.info(
          `[economy-reconciliation] ✅ Clean run — ${walletsChecked} wallets checked, 0 discrepancies.`
        );
      } else {
        logger.error(
          `[economy-reconciliation] ⚠️  Run complete — ${walletsChecked} wallets checked, ` +
          `${discrepancyCount} discrepanc${discrepancyCount === 1 ? 'y' : 'ies'} found. ` +
          'Check logs above for userId/delta details. No automatic corrections applied.'
        );
      }

      return { walletsChecked, discrepancyCount };
    },
    { connection }
  );

  worker.on('completed', (job, result) => {
    logger.info(
      `[economy-reconciliation] Job ${job.id} completed: ` +
      `${result.walletsChecked} wallets, ${result.discrepancyCount} discrepancies`
    );
  });

  worker.on('failed', (job, err) => {
    logger.error(`[economy-reconciliation] Job ${job?.id} failed: ${err.message}`);
  });

  return worker;
}

module.exports = { createEconomyReconciliationWorker };
