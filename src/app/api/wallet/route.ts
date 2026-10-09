import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { failure } from "@/lib/http";
import { plans } from "@/lib/billing";
import { demoMode } from "@/lib/ai";
export async function GET() {
  try {
    const user = await requireUser();
    const records = await prisma.walletTransaction.findMany({
      where: { walletId: user.wallet!.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const orders = await prisma.order.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return NextResponse.json({
      balance: user.wallet!.balance,
      records,
      orders,
      plans,
      demo: demoMode(),
    });
  } catch (error) {
    return failure(error);
  }
}
