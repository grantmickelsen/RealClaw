import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DealDetail, DealDocument } from '../../store/deals';
import { formatDealPriceFull, formatDealDate } from '../../lib/formatters';

interface Props {
  deal: DealDetail;
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue} numberOfLines={2}>{value || '—'}</Text>
    </View>
  );
}

function WireFraudWarning({ closingDate }: { closingDate: string | null }) {
  if (!closingDate) return null;
  const days = Math.ceil((new Date(closingDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days > 7) return null;

  return (
    <View style={styles.wireFraud}>
      <Ionicons name="warning" size={16} color="#92400E" style={{ marginRight: 8 }} />
      <Text style={styles.wireFraudText}>
        <Text style={{ fontWeight: '700' }}>Wire Fraud Warning: </Text>
        Closing is within 7 days. Always verify wiring instructions via a direct phone call — never trust email-only changes to bank account details.
      </Text>
    </View>
  );
}

function ComplianceSummary({ documents }: { documents: DealDocument[] }) {
  const required = documents.filter(d => d.status === 'required' && d.is_blocking);
  if (!documents.length) return null;

  return (
    <View style={styles.complianceCard}>
      <Text style={styles.complianceTitle}>Compliance Summary</Text>
      {documents.map(d => (
        <View key={d.id} style={styles.complianceRow}>
          <Ionicons
            name={d.status === 'signed' || d.status === 'waived' ? 'checkmark-circle' : d.status === 'required' ? 'alert-circle-outline' : 'cloud-upload-outline'}
            size={14}
            color={d.status === 'signed' ? '#10B981' : d.status === 'required' ? '#EF4444' : '#F59E0B'}
            style={{ marginRight: 6 }}
          />
          <Text style={styles.complianceDocName}>{d.name}</Text>
          <Text style={[styles.complianceStatus, {
            color: d.status === 'signed' ? '#10B981' : d.status === 'required' ? '#EF4444' : '#F59E0B',
          }]}>
            {d.status}
          </Text>
        </View>
      ))}
      {required.length > 0 && (
        <Text style={styles.complianceWarning}>
          {required.length} blocking disclosure{required.length > 1 ? 's' : ''} still required before close.
        </Text>
      )}
    </View>
  );
}

export function ContractXRay({ deal }: Props) {
  const partyLabel = deal.deal_type === 'seller' ? 'Seller (Your Client)' : 'Buyer (Your Client)';
  const counterLabel = deal.deal_type === 'seller' ? 'Buyer' : 'Seller';
  const clientName = deal.deal_type === 'seller' ? deal.seller_name : deal.buyer_name;
  const counterName = deal.deal_type === 'seller' ? deal.buyer_name : deal.seller_name;

  return (
    <View style={styles.container}>
      <WireFraudWarning closingDate={deal.closing_date} />

      {/* Parties */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Parties</Text>
        <FieldRow label={partyLabel}  value={clientName ?? '—'} />
        <FieldRow label={counterLabel} value={counterName ?? '—'} />
        {deal.escrow_company && <FieldRow label="Escrow" value={deal.escrow_company} />}
        {deal.escrow_number  && <FieldRow label="Escrow #" value={deal.escrow_number} />}
      </View>

      {/* Financials */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Financials</Text>
        <FieldRow label="Purchase Price" value={formatDealPriceFull(deal.purchase_price)} />
        <FieldRow label="Earnest Money"  value={deal.earnest_money ? `${formatDealPriceFull(deal.earnest_money)} (due ${formatDealDate(deal.earnest_due_date)})` : '—'} />
        {deal.seller_concessions && <FieldRow label="Seller Concessions" value={deal.seller_concessions} />}
      </View>

      {/* Timeline */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Timeline</Text>
        <FieldRow label="Acceptance Date" value={formatDealDate(deal.acceptance_date)} />
        <FieldRow label="Closing Date"    value={formatDealDate(deal.closing_date)} />
      </View>

      {/* Property Attributes */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Property</Text>
        {deal.mls_number  && <FieldRow label="MLS #"      value={deal.mls_number} />}
        {deal.year_built  && <FieldRow label="Year Built" value={String(deal.year_built)} />}
        <FieldRow label="HOA"         value={deal.has_hoa ? 'Yes' : 'No'} />
        {deal.seller_foreign_person && (
          <FieldRow label="Foreign Seller" value="Yes — FIRPTA may apply" />
        )}
      </View>

      <ComplianceSummary documents={deal.documents} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
  wireFraud: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: '#FFFBEB', borderRadius: 10,
    borderWidth: 1, borderColor: '#FDE68A',
    padding: 12, marginBottom: 12,
  },
  wireFraudText: { flex: 1, fontSize: 13, color: '#92400E', lineHeight: 18 },
  card: {
    backgroundColor: '#fff', borderRadius: 12,
    borderWidth: 1, borderColor: '#F3F4F6',
    padding: 14, marginBottom: 10,
  },
  cardTitle: { fontSize: 13, fontWeight: '700', color: '#6B7280', marginBottom: 10, letterSpacing: 0.4 },
  fieldRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F9FAFB',
  },
  fieldLabel: { fontSize: 13, color: '#6B7280', flex: 1 },
  fieldValue: { fontSize: 13, fontWeight: '600', color: '#111827', flex: 1, textAlign: 'right' },
  complianceCard: {
    backgroundColor: '#F9FAFB', borderRadius: 12,
    borderWidth: 1, borderColor: '#E5E7EB',
    padding: 14, marginTop: 4,
  },
  complianceTitle: { fontSize: 13, fontWeight: '700', color: '#6B7280', marginBottom: 8, letterSpacing: 0.4 },
  complianceRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  complianceDocName: { flex: 1, fontSize: 13, color: '#374151' },
  complianceStatus: { fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  complianceWarning: {
    marginTop: 8, fontSize: 12, color: '#EF4444',
    fontWeight: '600', paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#FECACA',
  },
});
