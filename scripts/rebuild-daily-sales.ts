import "dotenv/config";
import { parseIsoDate } from "@/lib/date";
import { rebuildDailyProductSales } from "@/server/stats/rebuild";

function readArg(flag: string): string {
  const prefix = `--${flag}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  if (!arg) {
    throw new Error(`缺少必要參數 ${prefix}YYYY-MM-DD`);
  }
  return arg.slice(prefix.length);
}

async function main() {
  const from = parseIsoDate(readArg("from"));
  const to = parseIsoDate(readArg("to"));
  if (from.getTime() > to.getTime()) {
    throw new Error("--from 不得晚於 --to");
  }

  console.log(`重算 DailyProductSales：${from.toISOString().slice(0, 10)} ~ ${to.toISOString().slice(0, 10)}`);
  const result = await rebuildDailyProductSales({ from, to });
  console.log(`完成：掃描 ${result.ordersConsidered} 筆訂單，寫入 ${result.rowsWritten} 筆統計列`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
