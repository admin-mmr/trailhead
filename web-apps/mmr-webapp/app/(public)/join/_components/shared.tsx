import type React from 'react'
import { CheckCircle, Upload, CreditCard, User, ClipboardList } from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────
export type Plan = 'individual' | 'family' | 'family_upgrade'
export type Step = 'plan' | 'info' | 'payment' | 'proof' | 'done'

export interface MemberInfo {
  firstName: string
  lastName: string
  email: string
  phone: string
  wechatId: string
  district: string
  gender: string
  yearBorn: string
  nyrrRunnerName: string
}

export type FieldErrors = Partial<Record<keyof MemberInfo, string>>

export interface PayForm {
  payerName: string
  paymentDate: string
  memoField: string
  last4: string
}

export type PlanInfo = { label: string; labelZh: string; amount: number; desc: string; descZh: string }

// ── Inline field validation ─────────────────────────────────────────────────
export function validateInfoField(key: keyof MemberInfo, value: string): string {
  switch (key) {
    case 'firstName':
    case 'lastName':
      if (!value.trim()) return key === 'firstName' ? 'First name is required' : 'Last name is required'
      if (value.trim().length < 2) return 'Must be at least 2 characters'
      return ''
    case 'email':
      if (!value.trim()) return 'Email address is required'
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Enter a valid email address (e.g. jane@example.com)'
      return ''
    case 'phone':
      if (!value) return '' // optional
      if (!/^\+?[\d\s\-().]{7,}$/.test(value)) return 'Enter a valid phone number (at least 7 digits, e.g. 212-555-0100)'
      return ''
    case 'gender':
      if (!value) return 'Please select a gender — this helps us match your NYRR runner profile'
      return ''
    case 'yearBorn': {
      if (!value) return ''
      const n = Number(value)
      if (!Number.isInteger(n) || String(n) !== value.trim()) return 'Enter a 4-digit year (e.g. 1990)'
      if (n < 1900 || n > new Date().getFullYear()) return `Year must be between 1900 and ${new Date().getFullYear()}`
      return ''
    }
    default:
      return ''
  }
}

export const PLANS: Record<Plan, PlanInfo> = {
  individual: {
    label: 'Individual Membership',
    labelZh: '个人会员',
    amount: 30,
    desc: 'One runner, full club access',
    descZh: '单人跑者，完整俱乐部访问权限',
  },
  family: {
    label: 'Family Membership',
    labelZh: '家庭会员',
    amount: 50,
    desc: 'Up to 4 family members at one address',
    descZh: '同住家庭最多4名成员',
  },
  family_upgrade: {
    label: 'Family Upgrade',
    labelZh: '升级家庭会员',
    amount: 20,
    desc: 'Upgrade existing Individual to Family',
    descZh: '将现有个人会员升级为家庭会员',
  },
}

export const STEPS: { id: Step; label: string; icon: React.ReactNode }[] = [
  { id: 'plan', label: 'Plan', icon: <ClipboardList className="w-4 h-4" /> },
  { id: 'info', label: 'Info', icon: <User className="w-4 h-4" /> },
  { id: 'payment', label: 'Pay', icon: <CreditCard className="w-4 h-4" /> },
  { id: 'proof', label: 'Proof', icon: <Upload className="w-4 h-4" /> },
  { id: 'done', label: 'Done', icon: <CheckCircle className="w-4 h-4" /> },
]

export const STEP_ORDER: Step[] = ['plan', 'info', 'payment', 'proof', 'done']
