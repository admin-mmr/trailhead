// ============================================================
// /payment/success — Stripe Checkout return page
//
// Server component: retrieves the Checkout Session by id and shows
// the outcome. Membership activation itself happens via the webhook
// (payments insert → DB triggers), usually within seconds.
// ============================================================

import { CheckCircle, Clock } from 'lucide-react'
import { getStripe } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

export default async function PaymentSuccessPage({
  searchParams,
}: {
  searchParams: { session_id?: string }
}) {
  const sessionId = searchParams.session_id

  let paid = false
  let amount: number | null = null
  let paymentType = ''
  let refId = ''
  let loadError = false

  if (sessionId) {
    try {
      const session = await getStripe().checkout.sessions.retrieve(sessionId)
      paid = session.payment_status === 'paid'
      amount = session.amount_total != null ? session.amount_total / 100 : null
      paymentType = session.metadata?.paymentType ?? ''
      refId = session.metadata?.submissionId ?? session.client_reference_id ?? ''
    } catch {
      loadError = true
    }
  } else {
    loadError = true
  }

  const isMembership = paymentType.toLowerCase().includes('membership')
  const isDonation = paymentType.toLowerCase() === 'donation'

  return (
    <main className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-2xl mx-auto px-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
          {loadError ? (
            <>
              <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Clock className="w-9 h-9 text-amber-500" />
              </div>
              <h1 className="text-2xl font-bold text-[#0A2342] mb-2">
                Payment status unavailable · 无法获取付款状态
              </h1>
              <p className="text-gray-600">
                We could not look up this payment. If you completed checkout, your payment is safe —
                please check your email receipt from Stripe or contact us.
                <br />
                我们暂时无法查询此笔付款。如果您已完成付款，请查看 Stripe 发送的电子收据，或与我们联系。
              </p>
            </>
          ) : paid ? (
            <>
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-9 h-9 text-green-500" />
              </div>
              <h1 className="text-2xl font-bold text-[#0A2342] mb-2">
                {isDonation ? 'Thank You for Your Donation!' : 'Payment Successful!'}
                {' · '}
                {isDonation ? '感谢您的捐赠！' : '付款成功！'}
              </h1>
              {amount != null && (
                <p className="text-3xl font-bold text-[#F47B20] mb-4">${amount.toFixed(2)}</p>
              )}
              <p className="text-gray-600 mb-4">
                {isMembership ? (
                  <>
                    Your membership is being activated automatically — this usually takes less than a
                    minute. You&apos;ll receive a confirmation email shortly.
                    <br />
                    您的会员资格正在自动激活，通常不到一分钟即可完成。稍后您将收到确认邮件。
                  </>
                ) : isDonation ? (
                  <>
                    Your generous support helps us do more for our running community. A receipt has
                    been emailed to you.
                    <br />
                    您的慷慨支持帮助我们为跑步社区做更多的事情。收据已发送至您的邮箱。
                  </>
                ) : (
                  <>
                    Your payment has been received and recorded.
                    <br />
                    您的付款已收到并记录。
                  </>
                )}
              </p>
              {refId && (
                <div className="inline-block bg-gray-50 border border-gray-200 rounded-xl px-6 py-3 mb-6">
                  <p className="text-xs text-gray-500 uppercase tracking-wider">
                    Reference Number · 参考号
                  </p>
                  <p className="text-lg font-mono font-bold text-[#0A2342] mt-1">{refId}</p>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Clock className="w-9 h-9 text-amber-500" />
              </div>
              <h1 className="text-2xl font-bold text-[#0A2342] mb-2">
                Payment Processing · 付款处理中
              </h1>
              <p className="text-gray-600 mb-4">
                Your payment is still processing. We&apos;ll confirm it automatically as soon as it
                clears — no further action is needed.
                <br />
                您的付款仍在处理中。付款成功后我们将自动确认，无需其他操作。
              </p>
            </>
          )}
          <div className="flex gap-4 justify-center mt-4">
            <a
              href="/"
              className="bg-[#0A2342] text-white px-8 py-3 rounded-xl font-semibold hover:bg-[#0d2d55] transition-colors"
            >
              Back to Home · 返回首页
            </a>
            {paid && isMembership && (
              <a
                href="/login"
                className="border border-gray-300 text-gray-700 px-8 py-3 rounded-xl font-semibold hover:bg-gray-50 transition-colors"
              >
                Log In · 登录
              </a>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
