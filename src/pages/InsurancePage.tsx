import FinanceFundPage from './FinanceFundPage';
import { PTTYPE } from '../queries/finance';

export default function InsurancePage() {
  return (
    <FinanceFundPage
      title="ประกันชีวิต / ประกันสุขภาพ"
      pttype={PTTYPE.INSURANCE}
      fundDescription="กองทุนประกันชีวิตและประกันสุขภาพเอกชน (LI)"
    />
  );
}
