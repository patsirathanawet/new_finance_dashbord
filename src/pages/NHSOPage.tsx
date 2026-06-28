import FinanceFundPage from './FinanceFundPage';
import { PTTYPE } from '../queries/finance';

export default function NHSOPage() {
  return (
    <FinanceFundPage
      title="สปสช. (NHSO)"
      pttype={PTTYPE.NHSO}
      nhsoLink={true}
      fundDescription="กองทุนหลักประกันสุขภาพแห่งชาติ (บัตรทอง UC/UCS/WEL)"
    />
  );
}
