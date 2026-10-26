export const SEARCH_INDEXES = [
 {name:'operations_by_sender_recent',sql:'CREATE INDEX operations_by_sender_recent ON operations(sender, timestamp DESC, block_hash DESC, operation_index ASC)'},
 {name:'operations_by_recipient_recent',sql:'CREATE INDEX operations_by_recipient_recent ON operations(recipient, timestamp DESC, block_hash DESC, operation_index ASC)'}
];
// Only each branch's top offset+limit+1 keys can contribute to this page.
// The final merge sorts bounded candidate keys, never the full account history.
export function accountSearchPage({addresses,limit,offset=0,conditions=[],parameters=[],transfersOnly=false,anchorsOnly=false,anchorStatus=null}) {
 if(!Array.isArray(addresses)||!addresses.length||addresses.length>100||addresses.some(a=>typeof a!=='string'))throw Error('Invalid account search');
 if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0||offset>2000)throw Error('Refine this search to view more than 2,000 matches.');
 const predicates=[...conditions],values=[...parameters];
 if(transfersOnly)predicates.push('EXISTS (SELECT 1 FROM transfers WHERE transfers.block_hash=operations.block_hash AND transfers.operation_index=operations.operation_index)');
 if(anchorsOnly){predicates.push(`EXISTS (SELECT 1 FROM anchors WHERE anchors.block_hash=operations.block_hash AND anchors.operation_index=operations.operation_index ${anchorStatus?'AND anchors.signature_status=?':''})`);if(anchorStatus)values.push(anchorStatus);}
 const extra=predicates.length?` AND ${predicates.join(' AND ')}`:'';
 const branches=[],bindings=[];
 for(const address of new Set(addresses))for(const field of ['sender','recipient']){
  branches.push(`SELECT * FROM (
   SELECT operations.block_hash,operations.operation_index,operations.timestamp
   FROM operations INDEXED BY operations_by_${field}_recent
   WHERE operations.${field}=?${extra}
   ORDER BY operations.timestamp DESC,operations.block_hash DESC,operations.operation_index ASC
   LIMIT ?
  )`);
  bindings.push(address,...values,offset+limit+1);
 }
 return {sql:`WITH candidates AS MATERIALIZED (${branches.join(' UNION ')}), page AS MATERIALIZED (
  SELECT * FROM candidates ORDER BY timestamp DESC,block_hash DESC,operation_index ASC LIMIT ? OFFSET ?
 ) SELECT operations.block_hash,operations.operation_index,operations.operation_type,
 operations.sender,operations.recipient,operations.token,operations.amount,operations.timestamp,operations.details_json,
 anchors.signature_status AS anchor_signature_status
 FROM page INNER JOIN operations ON operations.block_hash=page.block_hash AND operations.operation_index=page.operation_index
 LEFT JOIN anchors ON anchors.block_hash=operations.block_hash AND anchors.operation_index=operations.operation_index
 ORDER BY page.timestamp DESC,page.block_hash DESC,page.operation_index ASC`,parameters:[...bindings,limit+1,offset]};
}
