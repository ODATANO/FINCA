using { finca } from '../db/schema';

@path: '/auth'
service AuthService {

  @open
  action Nonce(
    @mandatory
    address : String
  ) returns {
    nonce     : String;
    payload   : String;          // The exact message the user must sign
    expiresAt : Timestamp;
  };

  @open
  action Verify(
    @mandatory address   : String,
    @mandatory nonce     : String,
    @mandatory signature : String,
    @mandatory key       : String
  ) returns {
    jwt       : String;
    expiresAt : Timestamp;
    address   : String;
  };
}
