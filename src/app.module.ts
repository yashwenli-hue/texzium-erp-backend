import { AccountsCommercialApprovalModule } from './modules/revenueos/accounts-commercial-approval/accounts-commercial-approval.module';
import { SalesOrderAdvanceReceiptModule } from './modules/revenueos/sales-order-advance-receipt/sales-order-advance-receipt.module';
import { SalesOrderPaymentTermsModule } from './modules/revenueos/sales-order-payment-terms/sales-order-payment-terms.module';
import { ApprovalModule } from './modules/adminos/approval/approval.module';
import { WorkflowExecutorModule } from './modules/adminos/workflow-executor/workflow-executor.module';
import { WorkflowEngineModule } from './modules/adminos/workflow-engine/workflow-engine.module';
import { VendorBillModule } from './modules/operationsos/vendor-bill/vendor-bill.module';
import { QualityInspectionModule } from './modules/operationsos/quality-inspection/quality-inspection.module';
import { GoodsReceiptModule } from './modules/operationsos/goods-receipt/goods-receipt.module';
import { PurchaseOrderModule } from './modules/operationsos/purchase-order/purchase-order.module';
import { PurchaseRequisitionModule } from './modules/operationsos/purchase-requisition/purchase-requisition.module';
import { BalanceSheetModule } from './modules/financeos/balance-sheet/balance-sheet.module';
import { ProfitLossModule } from './modules/financeos/profit-loss/profit-loss.module';
import { TrialBalanceModule } from './modules/financeos/trial-balance/trial-balance.module';
import { GeneralLedgerModule } from './modules/financeos/general-ledger/general-ledger.module';
import { JournalEngineModule } from './modules/financeos/journal-engine/journal-engine.module';
import { EWayBillModule } from './modules/complianceos/e-way-bill/e-way-bill.module';
import { Module } from '@nestjs/common';
import { AuthModule } from './core/auth/auth.module';
import { UsersModule } from './modules/adminos/users/users.module';
import { RolesModule } from './modules/adminos/roles/roles.module';
import { PermissionsModule } from './modules/adminos/permissions/permissions.module';
import { RolePermissionsModule } from './modules/adminos/role-permissions/role-permissions.module';
import { LeadSourcesModule } from './modules/revenueos/lead-sources/lead-sources.module';
import { LeadsModule } from './modules/revenueos/leads/leads.module';
import { DataGovernanceModule } from './modules/revenueos/data-governance/data-governance.module';
import { IntegrationHubModule } from './modules/adminos/integration-hub/integration-hub.module';
import { ConnectorMappingsModule } from './modules/adminos/connector-mappings/connector-mappings.module';
import { WebhooksModule } from './modules/adminos/webhooks/webhooks.module';
import { LeadAssignmentsModule } from './modules/revenueos/lead-assignments/lead-assignments.module';
import { LeadFollowupsModule } from './modules/revenueos/lead-followups/lead-followups.module';
import { LeadStatusModule } from './modules/revenueos/lead-status/lead-status.module';
import { OpportunitiesModule } from './modules/revenueos/opportunities/opportunities.module';
import { QuotationsModule } from './modules/revenueos/quotations/quotations.module';
import { SalesOrdersModule } from './modules/revenueos/sales-orders/sales-orders.module';
import { InventoryModule } from './modules/operationsos/inventory/inventory.module';
import { StockInspectionsModule } from './modules/operationsos/stock-inspections/stock-inspections.module';
import { TreatmentJobsModule } from './modules/operationsos/treatment-jobs/treatment-jobs.module';
import { QcClearancesModule } from './modules/operationsos/qc-clearances/qc-clearances.module';
import { InventoryReservationsModule } from './modules/operationsos/inventory-reservations/inventory-reservations.module';
import { DispatchModule } from './modules/operationsos/dispatch/dispatch.module';
import { DeliveryModule } from './modules/operationsos/delivery/delivery.module';
import { ProformaInvoicesModule } from './modules/revenueos/proforma-invoices/proforma-invoices.module';
import { PurchaseRequisitionsModule } from './modules/operationsos/purchase-requisitions/purchase-requisitions.module';
import { SalesInvoicesModule } from './modules/revenueos/sales-invoices/sales-invoices.module';
import { GstEngineModule } from './modules/complianceos/gst-engine/gst-engine.module';
import { AccountsReceivableModule } from './modules/financeos/accounts-receivable/accounts-receivable.module';
import { PaymentCollectionsModule } from './modules/revenueos/payment-collections/payment-collections.module';
import { WarrantyModule } from './modules/operationsos/warranty/warranty.module';
import { ServiceTicketsModule } from './modules/operationsos/service-tickets/service-tickets.module';
import { EngineerVisitsModule } from './modules/operationsos/engineer-visits/engineer-visits.module';
import { AmcModule } from './modules/operationsos/amc/amc.module';
import { AmcVisitsModule } from './modules/operationsos/amc-visits/amc-visits.module';
import { SpareConsumptionModule } from './modules/operationsos/spare-consumption/spare-consumption.module';
import { RmaModule } from './modules/operationsos/rma/rma.module';
import { AssetsModule } from './modules/operationsos/assets/assets.module';
import { InstallationsModule } from './modules/operationsos/installations/installations.module';
import { CommissioningModule } from './modules/operationsos/commissioning/commissioning.module';
import { DocumentModule } from './modules/documentos/document.module';
import { EmailModule } from './core/email/email.module';
import { CommunicationModule } from './modules/adminos/communication/communication.module';
import { NotificationModule } from './core/notifications/notification.module';
import { WhatsAppModule } from './core/whatsapp/whatsapp.module';
import { GoodsReceiptsModule } from './modules/operationsos/goods-receipts/goods-receipts.module';
import { QualityInspectionsModule } from './modules/operationsos/quality-inspections/quality-inspections.module';
import { WarehousePutawaysModule } from './modules/operationsos/warehouse-putaways/warehouse-putaways.module';
import { ProductTagsModule } from './modules/operationsos/product-tags/product-tags.module';
import { VendorBillsModule } from './modules/operationsos/vendor-bills/vendor-bills.module';
import { AccountGroupsModule } from './modules/financeos/account-groups/account-groups.module';
import { ChartOfAccountsModule } from './modules/financeos/chart-of-accounts/chart-of-accounts.module';
import { FinancialYearsModule } from './modules/financeos/financial-years/financial-years.module';
import { JournalModule } from './modules/financeos/journal/journal.module';
import { VendorLedgersModule } from './modules/financeos/vendor-ledgers/vendor-ledgers.module';
import { CustomerLedgersModule } from './modules/financeos/customer-ledgers/customer-ledgers.module';
import { DispatchOrdersModule } from './modules/operationsos/dispatch-orders/dispatch-orders.module';
import { CompanyMasterModule } from './modules/complianceos/company-master/company-master.module';
import { CompanyGstModule } from './modules/complianceos/company-gst/company-gst.module';
import { CustomerMasterModule } from './modules/revenueos/customer-master/customer-master.module';
import { CustomerGstModule } from './modules/revenueos/customer-gst/customer-gst.module';
import { VendorsModule } from './modules/operationsos/vendors/vendors.module';
import { HsnMasterModule } from './modules/complianceos/hsn-master/hsn-master.module';
import { GstReturnsModule } from './modules/complianceos/gst-returns/gst-returns.module';
import { EInvoiceModule } from './modules/complianceos/e-invoice/e-invoice.module';
import { CollectionRemindersModule } from './modules/revenueos/collection-reminders/collection-reminders.module';
import { CustomerStatementsModule } from './modules/revenueos/customer-statements/customer-statements.module';
import { StatementPdfModule } from './modules/revenueos/statement-pdf/statement-pdf.module';
import { PaymentGatewayConfigModule } from './modules/adminos/payment-gateway-config/payment-gateway-config.module';
import { PaymentLinksModule } from './modules/revenueos/payment-links/payment-links.module';
import { ReceiptVouchersModule } from './modules/financeos/receipt-vouchers/receipt-vouchers.module';
import { ReceiptPdfModule } from './modules/financeos/receipt-pdf/receipt-pdf.module';
import { CreditNotesModule } from './modules/financeos/credit-notes/credit-notes.module';
import { DebitNotesModule } from './modules/financeos/debit-notes/debit-notes.module';
import { RefundVouchersModule } from './modules/financeos/refund-vouchers/refund-vouchers.module';
import { BadDebtWriteOffModule } from './modules/financeos/bad-debt-writeoff/bad-debt-writeoff.module';
import { CollectionsDashboardModule } from './modules/financeos/collections-dashboard/collections-dashboard.module';
import { SalesReportsModule } from './modules/revenueos/sales-reports/sales-reports.module';
import { SalesInvoiceItemsModule } from './modules/revenueos/sales-invoice-items/sales-invoice-items.module';
import { InventoryReportsModule } from './modules/operationsos/inventory-reports/inventory-reports.module';
import { PayablesDashboardModule } from './modules/financeos/payables-dashboard/payables-dashboard.module';
import { VendorPayablesModule } from './modules/financeos/vendor-payables/vendor-payables.module';
import { VendorPaymentsModule } from './modules/financeos/vendor-payments/vendor-payments.module';
import { CashflowDashboardModule } from './modules/financeos/cashflow-dashboard/cashflow-dashboard.module';
import { ProfitabilityDashboardModule } from './modules/financeos/profitability-dashboard/profitability-dashboard.module';
import { CustomerProfitabilityModule } from './modules/financeos/customer-profitability/customer-profitability.module';
import { VendorAnalyticsModule } from './modules/financeos/vendor-analytics/vendor-analytics.module';
import { EmployeeMasterModule } from './modules/hrms/employee-master/employee-master.module';
import { AttendanceModule } from './modules/hrms/attendance/attendance.module';
import { LeaveManagementModule } from './modules/hrms/leave-management/leave-management.module';
import { PayrollModule } from './modules/hrms/payroll/payroll.module';
import { PayslipPdfModule } from './modules/hrms/payslip-pdf/payslip-pdf.module';
import { HrmsDashboardModule } from './modules/hrms/hrms-dashboard/hrms-dashboard.module';
import { ProjectMasterModule } from './modules/projectos/project-master/project-master.module';
import { ProjectTasksModule } from './modules/projectos/project-tasks/project-tasks.module';
import { ProjectCostsModule } from './modules/projectos/project-costs/project-costs.module';
import { ProjectBillingModule } from './modules/projectos/project-billing/project-billing.module';
import { ProjectProfitabilityModule } from './modules/projectos/project-profitability/project-profitability.module';
import { DatabaseModule } from './core/database/database.module';
import { GstReconciliationModule } from './modules/complianceos/gst-reconciliation/gst-reconciliation.module';
import { EInvoiceIrnModule } from './modules/complianceos/e-invoice-irn/e-invoice-irn.module';
import { ExecutiveDashboardModule } from './modules/business-intelligenceos/executive-dashboard/executive-dashboard.module';
import { KpiIntelligenceModule } from './modules/business-intelligenceos/kpi-intelligence/kpi-intelligence.module';
import { ForecastingEngineModule } from './modules/business-intelligenceos/forecasting-engine/forecasting-engine.module';
import { AiBusinessAdvisorModule } from './modules/business-intelligenceos/ai-business-advisor/ai-business-advisor.module';
import { DispatchOrderItemsModule } from './modules/operationsos/dispatch-order-items/dispatch-order-items.module';
import { InventoryTransactionsModule } from './modules/operationsos/inventory-transactions/inventory-transactions.module';
import { InventoryEngineModule } from './modules/operationsos/inventory-engine/inventory-engine.module';
import { DocumentNumberSeriesModule } from './modules/adminos/document-number-series/document-number-series.module';


@Module({
  imports: [
    AccountsCommercialApprovalModule,
    SalesOrderAdvanceReceiptModule,
    SalesOrderPaymentTermsModule,
    ApprovalModule,
    WorkflowExecutorModule,
    WorkflowEngineModule,
    VendorBillModule,
    QualityInspectionModule,
    GoodsReceiptModule,
    PurchaseOrderModule,
    PurchaseRequisitionModule,
    BalanceSheetModule,
    ProfitLossModule,
    TrialBalanceModule,
    JournalEngineModule,
    EWayBillModule,
    AuthModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    RolePermissionsModule,
    LeadSourcesModule,
    LeadsModule,
    DataGovernanceModule,
    IntegrationHubModule,
    ConnectorMappingsModule,
    WebhooksModule,
    LeadAssignmentsModule,
    LeadFollowupsModule,
    LeadStatusModule,
    OpportunitiesModule,
    QuotationsModule,
    SalesOrdersModule,
    InventoryModule,
    StockInspectionsModule,
    TreatmentJobsModule,
    QcClearancesModule,
    InventoryReservationsModule,
    DispatchModule,
    DeliveryModule,
    ProformaInvoicesModule,
    PurchaseRequisitionsModule,
    GstEngineModule,
    SalesInvoicesModule,
    AccountsReceivableModule,
    PaymentCollectionsModule,
    WarrantyModule,
    EngineerVisitsModule,
    AmcModule,
    AmcVisitsModule,
    SpareConsumptionModule,
    RmaModule,
    AssetsModule,
    InstallationsModule,
    CommissioningModule,
    DocumentModule,
    EmailModule,
    CommunicationModule,
    NotificationModule,
    WhatsAppModule,
    ServiceTicketsModule,
    GoodsReceiptsModule,
    QualityInspectionsModule,
    WarehousePutawaysModule,
    ProductTagsModule,
    VendorBillsModule,
    AccountGroupsModule,
    ChartOfAccountsModule,
    FinancialYearsModule,
    JournalModule,
    VendorLedgersModule,
    CustomerLedgersModule,
    DispatchOrdersModule,
    CompanyMasterModule,
    CompanyGstModule,
    CustomerMasterModule,
    CustomerGstModule,
    VendorsModule,
    HsnMasterModule,
    GstReturnsModule,
    EInvoiceModule,
    CustomerStatementsModule,    
    StatementPdfModule,
    PaymentGatewayConfigModule,
    PaymentLinksModule,
    ReceiptVouchersModule,
    ReceiptPdfModule,
    CreditNotesModule,
    DebitNotesModule,
    RefundVouchersModule,
    BadDebtWriteOffModule,
    CollectionsDashboardModule,
    SalesReportsModule,
    SalesInvoiceItemsModule,
    InventoryReportsModule,
    PayablesDashboardModule,
    VendorPayablesModule,
    VendorPaymentsModule,
    CashflowDashboardModule,
    ProfitabilityDashboardModule,
    CustomerProfitabilityModule,
    VendorAnalyticsModule,
    EmployeeMasterModule,
    AttendanceModule,
    LeaveManagementModule,
    PayrollModule,
    PayslipPdfModule,
    HrmsDashboardModule,
    ProjectMasterModule,
    ProjectTasksModule,  
    ProjectCostsModule,
    ProjectBillingModule,
    ProjectProfitabilityModule,
    DatabaseModule,
    GstReconciliationModule,
    EInvoiceIrnModule,
    ExecutiveDashboardModule,
    KpiIntelligenceModule,
    ForecastingEngineModule,
    AiBusinessAdvisorModule,    
    DispatchOrderItemsModule,
    InventoryTransactionsModule,
    InventoryEngineModule,
    DocumentNumberSeriesModule,
    ],
})
export class AppModule {}
