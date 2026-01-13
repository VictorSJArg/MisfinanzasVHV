// Tipos para el sistema de chat conversacional

export interface ConversationContext {
    lastIntent: string;
    lastQuery: string;
    lastResults: TransactionSearchResult[];
    awaitingFollowUp: boolean;
    lastTimestamp: Date;
    pendingAction?: PendingAction;
}

export interface PendingAction {
    type: 'create' | 'edit' | 'delete' | 'confirm';
    data: any;
    step: number;
}

export interface TransactionSearchResult {
    id: string;
    date: string;
    description: string | null;
    amount: number;
    type: 'INCOME' | 'EXPENSE';
    category: string | null;
    account: string | null;
}

export interface CreateTransactionData {
    amount?: number;
    description?: string;
    type?: 'INCOME' | 'EXPENSE';
    categoryId?: string;
    accountId?: string;
    date?: string;
}

export interface EditTransactionData {
    transactionId?: string;
    amount?: number;
    description?: string;
    categoryId?: string;
    date?: string;
}
