import FinanceFundPage from './FinanceFundPage';
import { PTTYPE } from '../queries/finance';

export default function SelfPayPage() {
  return (
    <FinanceFundPage
      title="ชำระเอง (Self Pay)"
      pttype={PTTYPE.SELF_PAY}
      fundDescription="ผู้ป่วยชำระค่าบริการเอง (A)"
    />
  );
}
