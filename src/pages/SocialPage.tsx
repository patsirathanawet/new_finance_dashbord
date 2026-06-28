import FinanceFundPage from './FinanceFundPage';
import { PTTYPE } from '../queries/finance';

export default function SocialPage() {
  return (
    <FinanceFundPage
      title="ประกันสังคม"
      pttype={PTTYPE.SOCIAL}
      fundDescription="กองทุนประกันสังคม (SSI)"
    />
  );
}
