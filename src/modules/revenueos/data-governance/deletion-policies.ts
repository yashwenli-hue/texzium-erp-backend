import { CUSTOMER_DELETION_POLICY } from '../customer-master/customer-deletion.policy';
import { LEAD_DELETION_POLICY } from '../leads/lead-deletion.policy';
import { DELETION_ENTITY, DeletionPolicy } from './data-deletion';

// The deletion policy of each kind of record, for what starts from a tombstone (the
// log, restore, purge) rather than from the record itself.
export function policyFor(entityType: string): DeletionPolicy {
  switch (entityType) {
    case DELETION_ENTITY.LEAD:
      return LEAD_DELETION_POLICY;
    case DELETION_ENTITY.CUSTOMER:
      return CUSTOMER_DELETION_POLICY;
    default:
      throw new Error(`No deletion policy for entity type ${entityType}`);
  }
}
